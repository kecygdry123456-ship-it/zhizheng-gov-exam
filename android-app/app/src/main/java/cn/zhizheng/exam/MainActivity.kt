package cn.zhizheng.exam

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.TimePicker
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.net.HttpURLConnection
import java.net.URL

@SuppressLint("SetTextI18n")
class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorText: TextView
    private var setupView: View? = null
    private var serverUrl: String = ""
    private var studyPlanBridgeRegistered = false
    private var pendingStudyPlanDeepLink = false
    private var awaitingNotificationSettings = false
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            StudyReminderManager.createChannel(this)
            StudyReminderManager.scheduleNext(this)
            SmartPlanReminderManager.reschedule(this, includeMissedToday = true)
            Toast.makeText(this, "备考通知已开启", Toast.LENGTH_SHORT).show()
        } else {
            AlertDialog.Builder(this)
                .setTitle("需要通知权限")
                .setMessage("提醒设置已保存，但当前无法发送通知。请在系统设置中允许知政公考发送通知。")
                .setPositiveButton("去系统设置") { _, _ -> openNotificationSettings() }
                .setNegativeButton("稍后", null)
                .show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        StudyReminderManager.createChannel(this)
        if (StudyReminderManager.settings(this).enabled) StudyReminderManager.scheduleNext(this)
        SmartPlanReminderManager.reschedule(this, includeMissedToday = true)
        buildUi()
        configureWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    setupView != null && serverUrl.isNotBlank() -> hideServerSetup()
                    webView.canGoBack() -> webView.goBack()
                    else -> showAppOptions()
                }
            }
        })

        val savedUrl = preferences().getString(KEY_SERVER_URL, null).orEmpty()
        val migrateLegacyUrl = savedUrl.trim().trimEnd('/') == BuildConfig.LEGACY_WEB_URL
        serverUrl = if (migrateLegacyUrl) {
            SmartPlanReminderManager.deactivateCurrent(this)
            preferences().edit().putString(KEY_SERVER_URL, BuildConfig.DEFAULT_WEB_URL).apply()
            BuildConfig.DEFAULT_WEB_URL
        } else {
            ServerUrlValidator.normalize(savedUrl, BuildConfig.ALLOW_HTTP)
                ?: BuildConfig.DEFAULT_WEB_URL
        }
        pendingStudyPlanDeepLink = intent?.action == SmartPlanReminderManager.ACTION_OPEN_PLAN
        configureStudyPlanBridge()
        if (normalizedServerUrl() == null) {
            showServerSetup(canCancel = false)
        } else {
            loadHome()
        }
    }

    private fun buildUi() {
        root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.paper)) }
        webView = WebView(this).apply {
            setBackgroundColor(getColor(R.color.paper))
            setOnLongClickListener {
                showWebMenu(this)
                true
            }
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        errorText = TextView(this).apply {
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(getColor(R.color.ink))
        }
        val retry = primaryButton("重新加载").apply { setOnClickListener { loadHome() } }
        val settings = secondaryButton("检查服务器设置").apply { setOnClickListener { showServerSetup(true) } }
        errorPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            setBackgroundColor(getColor(R.color.paper))
            addView(errorText, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(22) })
            addView(retry, LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(10) })
            addView(settings, LinearLayout.LayoutParams(-1, dp(54)))
            visibility = View.GONE
        }
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        root.addView(errorPanel, FrameLayout.LayoutParams(-1, -1))
        root.addView(progress, FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
            userAgentString = "$userAgentString ZhizhengAndroid/${BuildConfig.VERSION_NAME}"
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                if (isSameOrigin(target, Uri.parse(serverUrl))) return false
                openExternalUri(target)
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                errorPanel.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (pendingStudyPlanDeepLink && url?.let { isSameOrigin(Uri.parse(it), Uri.parse(serverUrl)) } == true) {
                    dispatchStudyPlanDeepLink(view)
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showError("页面暂时无法打开\n${error.description}\n\n请检查网络或服务器状态。")
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                    showError("服务器返回错误 ${errorResponse.statusCode}\n请稍后重试；若持续出现，请检查云端服务。")
                }
            }

            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler, error: android.net.http.SslError?) {
                handler.cancel()
                showError("服务器 HTTPS 证书无效\n为保护账号和答题数据，连接已被阻止。")
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Toast.makeText(this@MainActivity, "页面进程已恢复，请重新加载", Toast.LENGTH_SHORT).show()
                view.destroy()
                recreate()
                return true
            }
        }
    }

    private fun configureStudyPlanBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        if (studyPlanBridgeRegistered) {
            runCatching { WebViewCompat.removeWebMessageListener(webView, STUDY_PLAN_BRIDGE) }
            studyPlanBridgeRegistered = false
        }
        val normalized = normalizedServerUrl() ?: return
        val originRule = originRule(Uri.parse(normalized)) ?: return
        WebViewCompat.addWebMessageListener(
            webView,
            STUDY_PLAN_BRIDGE,
            setOf(originRule),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy
                ) {
                    if (!isMainFrame || !isSameOrigin(sourceOrigin, Uri.parse(normalized))) return
                    val result = runCatching {
                        SmartPlanReminderManager.handleWebMessage(
                            this@MainActivity,
                            sourceOrigin.toString(),
                            message.data ?: return
                        )
                    }.getOrNull()
                    if (result == null) {
                        replyProxy.postMessage("{\"type\":\"STUDY_PLAN_REMINDER_RESULT\",\"ok\":false}")
                        return
                    }
                    replyProxy.postMessage(
                        "{\"type\":\"STUDY_PLAN_REMINDER_RESULT\",\"ok\":true," +
                            "\"action\":\"${result.action}\",\"scheduledDays\":${result.scheduledDays}," +
                            "\"unchanged\":${result.unchanged}}"
                    )
                    if (result.action == "SYNC_STUDY_PLAN" &&
                        !result.unchanged &&
                        SmartPlanReminderManager.hasActivePlan(this@MainActivity) &&
                        !StudyReminderManager.hasNotificationPermission(this@MainActivity)
                    ) {
                        requestNotificationPermission()
                    }
                }
            }
        )
        studyPlanBridgeRegistered = true
    }

    private fun originRule(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (scheme !in setOf("http", "https")) return null
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "$scheme://$host$port"
    }

    private fun dispatchStudyPlanDeepLink(view: WebView) {
        val currentUrl = view.url?.let(Uri::parse) ?: return
        if (!isSameOrigin(currentUrl, Uri.parse(serverUrl))) return
        pendingStudyPlanDeepLink = false
        val script = """
            (() => {
              try { sessionStorage.setItem('zhizheng:native-destination', 'plan'); } catch (_) {}
              window.dispatchEvent(new Event('zhizheng:open-study-plan'));
            })();
        """.trimIndent()
        view.evaluateJavascript(script, null)
    }

    private fun showServerSetup(canCancel: Boolean) {
        setupView?.let { root.removeView(it) }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(getColor(R.color.paper))
        }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(38), dp(24), dp(32))
        }
        val mark = TextView(this).apply {
            text = "知"
            textSize = 30f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#4572ef"), Color.parseColor("#2f56d6"))
            ).apply {
                cornerRadius = dp(20f).toFloat()
                gradientType = GradientDrawable.LINEAR_GRADIENT
            }
        }
        val brand = TextView(this).apply {
            text = "知政公考"
            textSize = 26f
            gravity = Gravity.CENTER
            setTextColor(getColor(R.color.ink))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            letterSpacing = 0.06f
        }
        val slogan = TextView(this).apply {
            text = "连接学习服务，开始高效备考"
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#6b7fa0"))
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(26), dp(24), dp(24))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(Color.WHITE)
                cornerRadius = dp(22f).toFloat()
                setStroke(dp(1), Color.parseColor("#dce5f5"))
            }
            elevation = dp(4).toFloat()
        }
        val title = TextView(this).apply {
            text = "学习服务器设置"
            textSize = 20f
            setTextColor(getColor(R.color.ink))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        val description = TextView(this).apply {
            text = "应用已预置知政公考官方服务器。也可填写你自行部署的 HTTPS 网页与 API 根地址。"
            textSize = 14f
            setLineSpacing(0f, 1.25f)
            setTextColor(Color.parseColor("#667085"))
        }
        val label = TextView(this).apply {
            text = "服务器地址"
            textSize = 14f
            setTextColor(getColor(R.color.ink))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        val input = EditText(this).apply {
            hint = "https://exam.example.com"
            setText(serverUrl)
            textSize = 15f
            setSingleLine(true)
            setPadding(dp(16), 0, dp(16), 0)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                setColor(Color.parseColor("#f5f8ff"))
                cornerRadius = dp(13f).toFloat()
                setStroke(dp(1), Color.parseColor("#d0daee"))
            }
        }
        val hint = TextView(this).apply {
            text = if (BuildConfig.ALLOW_HTTP) {
                "官方服务器：${BuildConfig.DEFAULT_WEB_URL}\n调试版也支持局域网 HTTP 地址"
            } else {
                "官方服务器：${BuildConfig.DEFAULT_WEB_URL}\n其他自定义服务器必须使用有效 HTTPS 地址"
            }
            textSize = 12f
            setLineSpacing(0f, 1.2f)
            setTextColor(Color.parseColor("#8792A5"))
        }
        val status = TextView(this).apply {
            textSize = 13f
            visibility = View.GONE
        }
        val connect = primaryButton("检测并连接")
        connect.setOnClickListener { testAndSaveServer(input, connect, status) }
        card.addView(title, LinearLayout.LayoutParams(-1, -2))
        card.addView(description, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10); bottomMargin = dp(22) })
        card.addView(label, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        card.addView(input, LinearLayout.LayoutParams(-1, dp(54)))
        card.addView(hint, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(9) })
        card.addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        card.addView(connect, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(20) })
        if (canCancel) {
            val cancel = Button(this).apply {
                text = "返回应用"
                textSize = 14f
                setTextColor(getColor(R.color.brand))
                setBackgroundColor(Color.TRANSPARENT)
                setOnClickListener { hideServerSetup() }
            }
            card.addView(cancel, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(4) })
        }
        val privacy = TextView(this).apply {
            text = "地址仅保存在本机。账号密码与答题数据由你的服务器处理。"
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#98A2B3"))
        }
        page.addView(mark, LinearLayout.LayoutParams(dp(72), dp(72)))
        page.addView(brand, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(16) })
        page.addView(slogan, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5) })
        page.addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(30) })
        page.addView(privacy, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(24) })
        scroll.addView(page, ViewGroup.LayoutParams(-1, -2))
        setupView = scroll
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
    }

    private fun testAndSaveServer(input: EditText, button: Button, status: TextView) {
        val normalized = ServerUrlValidator.normalize(
            input.text.toString(),
            BuildConfig.ALLOW_HTTP
        )
        if (normalized == null) {
            input.error = if (BuildConfig.ALLOW_HTTP) {
                "请输入有效的 HTTP 或 HTTPS 地址"
            } else {
                "请输入有效的 HTTPS 地址，或使用预置官方服务器"
            }
            return
        }
        if (!isOnline()) {
            showSetupStatus(status, "当前网络不可用，请联网后重试。", false)
            return
        }
        button.isEnabled = false
        button.text = "正在检测服务器…"
        showSetupStatus(status, "正在检查 /api/health…", true)
        Thread {
            val result = runCatching {
                val connection = URL(ServerUrlValidator.healthUrl(normalized)).openConnection() as HttpURLConnection
                connection.connectTimeout = 8_000
                connection.readTimeout = 8_000
                connection.requestMethod = "GET"
                connection.setRequestProperty("Accept", "application/json")
                connection.useCaches = false
                val code = connection.responseCode
                connection.disconnect()
                if (code !in 200..299) error("健康检查返回 HTTP $code")
            }
            runOnUiThread {
                button.isEnabled = true
                button.text = "检测并连接"
                result.onSuccess {
                    val previousUrl = normalizedServerUrl()
                    if (previousUrl != null && !isSameOrigin(Uri.parse(previousUrl), Uri.parse(normalized))) {
                        SmartPlanReminderManager.deactivateCurrent(this)
                    }
                    serverUrl = normalized
                    preferences().edit().putString(KEY_SERVER_URL, normalized).apply()
                    configureStudyPlanBridge()
                    showSetupStatus(status, "连接成功，正在打开知政公考…", true)
                    input.postDelayed({ hideServerSetup(); loadHome() }, 450)
                }.onFailure {
                    showSetupStatus(status, "连接失败：${it.message ?: "无法访问服务器"}\n请确认服务已部署且 /api/health 可访问。", false)
                }
            }
        }.start()
    }

    private fun showSetupStatus(view: TextView, message: String, success: Boolean) {
        view.text = message
        view.setTextColor(if (success) Color.parseColor("#16803A") else Color.parseColor("#C2412D"))
        view.visibility = View.VISIBLE
    }

    private fun hideServerSetup() {
        setupView?.let { root.removeView(it) }
        setupView = null
    }

    private fun showWebMenu(anchor: View) {
        PopupMenu(this, anchor).apply {
            menu.add("刷新页面")
            menu.add("返回首页")
            menu.add("备考通知")
            menu.add("更换服务器")
            menu.add("清除登录会话")
            setOnMenuItemClickListener {
                when (it.title.toString()) {
                    "刷新页面" -> webView.reload()
                    "返回首页" -> loadHome()
                    "备考通知" -> showReminderSettings()
                    "更换服务器" -> showServerSetup(true)
                    "清除登录会话" -> clearSession()
                }
                true
            }
            show()
        }
    }

    private fun showAppOptions() {
        AlertDialog.Builder(this)
            .setTitle("应用操作")
            .setItems(arrayOf("刷新页面", "备考通知", "更换服务器", "清除登录会话", "退出应用")) { _, which ->
                when (which) {
                    0 -> webView.reload()
                    1 -> showReminderSettings()
                    2 -> showServerSetup(true)
                    3 -> clearSession()
                    4 -> finish()
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun showReminderSettings() {
        val current = StudyReminderManager.settings(this)
        val planStatus = SmartPlanReminderManager.status(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(4), dp(24), 0)
        }
        val description = TextView(this).apply {
            text = "智能规划会在指定时间汇总当天任务；固定提醒只在当天没有智能规划时发送。省电模式下可能有少量延迟。"
            textSize = 14f
            setTextColor(Color.parseColor("#667085"))
            setLineSpacing(0f, 1.2f)
        }
        val planState = TextView(this).apply {
            text = when {
                planStatus == null -> "智能规划：尚未同步"
                !planStatus.enabled -> "智能规划：已同步，计划提醒已暂停"
                planStatus.pendingDates.isEmpty() -> "智能规划：已同步，本轮暂无待提醒学习日"
                else -> "智能规划：待提醒 ${planStatus.pendingDates.size} 天\n" +
                    planStatus.pendingDates.joinToString("、") { "${it.monthValue}月${it.dayOfMonth}日" }
            }
            textSize = 13f
            setTextColor(Color.parseColor("#39465A"))
            setLineSpacing(0f, 1.2f)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = roundedDrawable(Color.parseColor("#F3F6FA"), 10f)
        }
        val smartEnabled = CheckBox(this).apply {
            text = "按智能规划提醒"
            textSize = 16f
            isChecked = planStatus?.enabled == true
            isEnabled = planStatus != null
            setTextColor(getColor(R.color.ink))
            setPadding(0, dp(12), 0, dp(4))
        }
        val fixedEnabled = CheckBox(this).apply {
            text = "当天无计划时发送固定提醒"
            textSize = 16f
            isChecked = current.enabled
            setTextColor(getColor(R.color.ink))
            setPadding(0, dp(4), 0, dp(4))
        }
        val timeLabel = TextView(this).apply {
            text = "统一提醒时间"
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.ink))
        }
        val timePicker = TimePicker(this).apply {
            setIs24HourView(true)
            hour = current.hour
            minute = current.minute
        }
        val messageLabel = TextView(this).apply {
            text = "固定提醒文案"
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(getColor(R.color.ink))
        }
        val message = EditText(this).apply {
            setText(current.message)
            hint = StudyReminderManager.DEFAULT_MESSAGE
            textSize = 15f
            minLines = 2
            maxLines = 3
            filters = arrayOf(InputFilter.LengthFilter(120))
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = roundedDrawable(Color.parseColor("#F8FAFC"), 13f, Color.parseColor("#CBD5E1"))
        }
        content.addView(description, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        content.addView(planState, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(2) })
        content.addView(smartEnabled, LinearLayout.LayoutParams(-1, -2))
        content.addView(fixedEnabled, LinearLayout.LayoutParams(-1, -2))
        content.addView(timeLabel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        content.addView(timePicker, LinearLayout.LayoutParams(-1, -2))
        content.addView(messageLabel, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4); bottomMargin = dp(8) })
        content.addView(message, LinearLayout.LayoutParams(-1, -2))

        val scroll = ScrollView(this).apply { addView(content, ViewGroup.LayoutParams(-1, -2)) }
        AlertDialog.Builder(this)
            .setTitle("备考通知")
            .setView(scroll)
            .setPositiveButton("保存") { _, _ ->
                val settings = StudyReminderManager.Settings(
                    enabled = fixedEnabled.isChecked,
                    hour = timePicker.hour,
                    minute = timePicker.minute,
                    message = message.text.toString()
                )
                StudyReminderManager.save(this, settings)
                if (planStatus != null) {
                    SmartPlanReminderManager.setEnabled(this, smartEnabled.isChecked)
                }
                val smartActive = planStatus != null && smartEnabled.isChecked
                if ((settings.enabled || smartActive) &&
                    !StudyReminderManager.hasNotificationPermission(this)
                ) {
                    requestNotificationPermission()
                } else {
                    val result = when {
                        smartActive && settings.enabled ->
                            "计划与固定提醒已保存：${formatTime(settings.hour, settings.minute)}"
                        smartActive ->
                            "智能规划提醒已保存：${formatTime(settings.hour, settings.minute)}"
                        settings.enabled ->
                            "固定提醒已保存：${formatTime(settings.hour, settings.minute)}"
                        else -> "备考通知已关闭"
                    }
                    Toast.makeText(this, result, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !StudyReminderManager.hasRuntimeNotificationPermission(this)
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            AlertDialog.Builder(this)
                .setTitle("系统通知已关闭")
                .setMessage("计划已保存，但系统当前不允许知政公考发送通知。请在系统设置中开启通知后返回。")
                .setPositiveButton("去系统设置") { _, _ -> openNotificationSettings() }
                .setNegativeButton("稍后", null)
                .show()
        }
    }

    private fun openNotificationSettings() {
        val intent = Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)
        awaitingNotificationSettings = true
        runCatching { startActivity(intent) }.onFailure {
            awaitingNotificationSettings = false
            Toast.makeText(this, "无法打开通知设置", Toast.LENGTH_SHORT).show()
        }
    }

    private fun formatTime(hour: Int, minute: Int) = "%02d:%02d".format(hour, minute)

    private fun loadHome() {
        if (!isOnline()) {
            showError("当前网络不可用\n请联网后重新加载。")
            return
        }
        val normalized = normalizedServerUrl()
        if (normalized == null) {
            showServerSetup(false)
            return
        }
        hideServerSetup()
        errorPanel.visibility = View.GONE
        webView.loadUrl(normalized)
    }

    private fun clearSession() {
        SmartPlanReminderManager.deactivateCurrent(this)
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            webView.clearCache(true)
            Toast.makeText(this, "登录会话已清除", Toast.LENGTH_SHORT).show()
            loadHome()
        }
    }

    private fun showError(message: String) {
        errorText.text = message
        errorPanel.visibility = View.VISIBLE
    }

    private fun normalizedServerUrl() = ServerUrlValidator.normalize(
        serverUrl,
        BuildConfig.ALLOW_HTTP
    )

    private fun isSameOrigin(target: Uri, origin: Uri): Boolean {
        fun effectivePort(uri: Uri): Int = when {
            uri.port != -1 -> uri.port
            uri.scheme.equals("https", true) -> 443
            uri.scheme.equals("http", true) -> 80
            else -> -1
        }
        return target.scheme.equals(origin.scheme, true) &&
            target.host.equals(origin.host, true) &&
            effectivePort(target) == effectivePort(origin)
    }

    private fun openExternalUri(uri: Uri) {
        val scheme = uri.scheme?.lowercase()
        if (scheme !in setOf("http", "https", "mailto", "tel")) {
            Toast.makeText(this, "不支持打开此类链接", Toast.LENGTH_SHORT).show()
            return
        }
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { Toast.makeText(this, "未找到可打开此链接的应用", Toast.LENGTH_SHORT).show() }
    }

    private fun primaryButton(label: String) = Button(this).apply {
        text = label
        textSize = 16f
        setTextColor(Color.WHITE)
        stateListAnimator = null
        background = GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(Color.parseColor("#4572ef"), Color.parseColor("#2f56d6"))
        ).apply {
            cornerRadius = dp(13f).toFloat()
            gradientType = GradientDrawable.LINEAR_GRADIENT
        }
    }

    private fun secondaryButton(label: String) = Button(this).apply {
        text = label
        textSize = 15f
        setTextColor(getColor(R.color.brand_light))
        stateListAnimator = null
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.WHITE)
            cornerRadius = dp(13f).toFloat()
            setStroke(dp(1), Color.parseColor("#d0daee"))
        }
    }

    private fun roundedDrawable(fill: Int, radiusDp: Float, stroke: Int? = null) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fill)
        cornerRadius = dp(radiusDp).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }

    private fun preferences() = getSharedPreferences("zhizheng_settings", Context.MODE_PRIVATE)

    private fun isOnline(): Boolean {
        val manager = getSystemService(ConnectivityManager::class.java)
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun dp(value: Float) = (value * resources.displayMetrics.density).toInt()

    override fun onPause() {
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (awaitingNotificationSettings) {
            awaitingNotificationSettings = false
            if (StudyReminderManager.hasNotificationPermission(this)) {
                StudyReminderManager.scheduleNext(this)
                SmartPlanReminderManager.reschedule(this, includeMissedToday = true)
                Toast.makeText(this, "通知权限已恢复", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == SmartPlanReminderManager.ACTION_OPEN_PLAN) {
            pendingStudyPlanDeepLink = true
            webView.post { dispatchStudyPlanDeepLink(webView) }
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_url"
        private const val STUDY_PLAN_BRIDGE = "ZhizhengAndroid"
    }
}
