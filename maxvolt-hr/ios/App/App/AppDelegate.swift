import UIKit
import Capacitor
import Network

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // This app loads its content live from the network (capacitor.config.json
    // server.url) rather than bundling it locally, so a page load that fails
    // while offline (e.g. walking out of WiFi/cellular coverage — shows up as
    // NSURLErrorDomain -1003, "server with the specified hostname could not
    // be found") leaves a blank WKWebView with nothing to retry it; without
    // this, the only way to recover was to force-quit and reopen the app.
    // Watches for the device's network path going from unusable back to
    // usable and reloads the web content automatically at that moment, so
    // it self-heals instead.
    private let networkMonitor = NWPathMonitor()
    private var lastPathSatisfied = true

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        startNetworkMonitor()
        return true
    }

    private func startNetworkMonitor() {
        networkMonitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            let satisfied = path.status == .satisfied
            if satisfied && !self.lastPathSatisfied {
                // Small delay so the interface has actually stabilized
                // before retrying, rather than racing a link that's still
                // coming up.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    self.reloadWebViewIfNeeded()
                }
            }
            self.lastPathSatisfied = satisfied
        }
        networkMonitor.start(queue: DispatchQueue(label: "com.maxvolt.hr.networkMonitor"))
    }

    private func reloadWebViewIfNeeded() {
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeVC.bridge?.webView else { return }
        // .reload() only reliably has something to reload once a page has
        // actually committed — after a FAILED provisional navigation (the
        // exact case this is recovering from) there may be nothing for it to
        // repeat. Issue a fresh .load() instead: webView.url still reflects
        // the last-attempted address in that case; the hardcoded fallback
        // matches capacitor.config.json's server.url for the rare case it's
        // nil (e.g. the very first launch failed before anything loaded).
        let target = webView.url ?? URL(string: "https://maxone.maxvoltenergy.com")
        if let target = target {
            webView.load(URLRequest(url: target))
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // Required for push notifications to work at all — @capacitor-firebase/messaging's
    // native plugin (FirebaseMessagingPlugin.swift) only picks up the APNs
    // device token by listening for Capacitor's own `.capacitorDidRegisterForRemoteNotifications`
    // notification; that notification is never posted unless THIS delegate
    // method explicitly forwards it. Without it, UIApplication.registerForRemoteNotifications()
    // (called by the plugin) still "succeeds" from iOS's point of view, but the
    // resulting device token has nowhere to go — Messaging.messaging().apnsToken
    // never gets set, no FCM token is ever produced, and the app silently never
    // receives a single push notification, with no error surfaced anywhere.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
