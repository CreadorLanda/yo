package expo.modules.callkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the process alive for the duration of a call.
 *
 * Android does not let an app hold the microphone in the background without
 * one of these, and from API 31 it freezes the process outright. The
 * notification is not a courtesy — it is the price of the exemption, and the
 * system will not grant it without one.
 *
 * Deliberately does nothing else. It does not touch LiveKit, WebRTC or the
 * audio session: those already work while the app is alive, and the only
 * thing that was missing is staying alive. A service that also managed the
 * call would be two sources of truth about whether one is running.
 */
class CallForegroundService : Service() {

  companion object {
    const val ACTION_START = "app.yo.call.START"
    const val ACTION_STOP = "app.yo.call.STOP"
    const val EXTRA_VIDEO = "video"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    private const val CHANNEL_ID = "yo.call.ongoing"
    private const val NOTIFICATION_ID = 0x0CA11
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Ongoing call"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: "Tap to return to the call"

    ensureChannel()
    val notification = buildNotification(title, body)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // The declared type has to match what the service actually does, and
      // from API 34 it has to be backed by a matching permission. Claiming
      // camera on a voice call would be asking for a permission we have no
      // use for, which is how an app ends up explaining itself in a review.
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (video) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // START_NOT_STICKY: if the system kills us, the call is already over.
    // Restarting the service without a call to keep alive would leave a
    // notification for something that is not happening.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    // LOW, and silent. The call itself is already making noise; a channel
    // that chimes on top of it is the app talking over the person.
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Ongoing calls",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shown while a call is running so the system keeps it connected."
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, body: String): Notification {
    // Reopen the app rather than a deep link: this module knows nothing about
    // routes, and a wrong one is worse than the screen they were last on.
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = launch?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      // The app's own icon is not guaranteed to be a valid small icon (it
      // must be a white-on-transparent silhouette), and a bad one shows as a
      // grey square. The platform call symbol always renders.
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .apply { pending?.let { setContentIntent(it) } }
      .build()
  }
}
