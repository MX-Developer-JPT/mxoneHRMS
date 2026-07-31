# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# ── Capacitor / Firebase safety net ──────────────────────────
# Capacitor plugins call into native methods reflectively via
# @CapacitorPlugin/@PluginMethod annotations — R8 must not strip or
# rename these or the JS-to-native bridge breaks silently at runtime.
# Each Capacitor/community plugin AAR ships its own consumer-rules.pro
# that Gradle merges automatically, but this is a deliberate belt-and-
# suspenders net for the core bridge + the plugins this app actually
# uses (background geolocation, Firebase messaging) in case any one of
# them is missing/incomplete consumer rules.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
