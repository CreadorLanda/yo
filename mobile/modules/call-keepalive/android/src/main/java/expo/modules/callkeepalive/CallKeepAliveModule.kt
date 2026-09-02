package expo.modules.callkeepalive

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Start and stop the call foreground service from JavaScript.
 *
 * The JS side owns when a call begins and ends — it is the only thing that
 * knows — so this is deliberately thin. Its whole job is to make the service
 * reachable, and to be honest about failing.
 */
class CallKeepAliveModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("CallKeepAlive")

    Function("isSupported") { true }

    /**
     * `title` and `body` come from JS so the notification is in the reader's
     * language. A native module has no access to the app's translations, and
     * an English string on a Portuguese phone is the kind of detail that
     * makes an app feel foreign.
     */
    Function("start") { video: Boolean, title: String?, body: String? ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, CallForegroundService::class.java).apply {
        action = CallForegroundService.ACTION_START
        putExtra(CallForegroundService.EXTRA_VIDEO, video)
        title?.let { putExtra(CallForegroundService.EXTRA_TITLE, it) }
        body?.let { putExtra(CallForegroundService.EXTRA_BODY, it) }
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (e: Exception) {
        // Android 12+ refuses to start a foreground service from the
        // background, and 14+ refuses without the matching permission.
        // Returning false rather than throwing: a call that cannot be kept
        // alive should still connect and work while the app is open, which is
        // exactly what happened before this module existed.
        false
      }
    }

    // `?.let` rather than an early return. Expo infers this lambda's return
    // type as `Any?`, and a bare `return@Function` yields `Unit`, which the
    // elvis cannot reconcile with it — the one line of this module that did
    // not survive first contact with the Kotlin compiler. `OnDestroy` below
    // has always used this shape, and always compiled.
    Function("stop") {
      appContext.reactContext?.let { context ->
        val intent = Intent(context, CallForegroundService::class.java).apply {
          action = CallForegroundService.ACTION_STOP
        }
        try {
          context.stopService(intent)
        } catch (e: Exception) {
          // Already gone. Stopping a service that is not running is not a
          // problem worth surfacing to a call screen that is tearing down.
        }
      }
    }

    // The service must not outlive the app. Without this, force-quitting
    // during a call leaves a notification for a call nobody is on.
    OnDestroy {
      appContext.reactContext?.let {
        it.stopService(Intent(it, CallForegroundService::class.java))
      }
    }
  }
}
