plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cn.zhizheng.exam"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "cn.zhizheng.exam"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "1.3.1"
        buildConfigField("String", "DEFAULT_WEB_URL", "\"https://8.163.38.217\"")
        buildConfigField("String", "LEGACY_WEB_URL", "\"http://8.163.38.217\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["cleartextTrafficPermitted"] = "false"
    }

    buildTypes {
        debug {
            buildConfigField("boolean", "ALLOW_HTTP", "true")
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            manifestPlaceholders["cleartextTrafficPermitted"] = "true"
        }
        release {
            buildConfigField("boolean", "ALLOW_HTTP", "false")
            isMinifyEnabled = false
            manifestPlaceholders["cleartextTrafficPermitted"] = "false"
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
