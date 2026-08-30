package org.splitsync.stopwatch.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANNEL_ID = "running-stopwatch"
private const val NOTIFICATION_ID = 231

/**
 * Ongoing "running stopwatch" notification (#231).
 *
 * Posts a single ongoing, silent notification whose elapsed time is rendered by
 * Android's own notification chronometer (`setUsesChronometer` + `setWhen`), so
 * it ticks every second with zero JS wakeups and keeps ticking while the app is
 * backgrounded. Tapping it returns to the app; it is cleared on stop/reset.
 */
class StopwatchNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("StopwatchNotification")

    // True when the app may currently post notifications.
    Function("hasPermission") {
      hasNotificationPermission()
    }

    // Asks for POST_NOTIFICATIONS (Android 13+). Resolves with whether it is
    // now granted. On Android 12 and below there is no runtime permission —
    // resolves with whether notifications are enabled for the app.
    AsyncFunction("requestPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33) {
        promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
        return@AsyncFunction
      }
      if (hasNotificationPermission()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result ->
          val granted = result.values.all { it.status == PermissionsStatus.GRANTED }
          promise.resolve(granted)
        },
        Manifest.permission.POST_NOTIFICATIONS
      )
    }

    // Shows (or replaces) the ongoing chronometer notification.
    // `startedAtMs` is epoch millis of the running stopwatch's zero point.
    Function("show") { title: String, text: String, startedAtMs: Double ->
      showNotification(title, text, startedAtMs.toLong())
    }

    // Removes the ongoing notification (stop / reset / leaving the stopwatch).
    Function("clear") {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
  }

  private fun hasNotificationPermission(): Boolean {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    if (Build.VERSION.SDK_INT < 33) {
      return enabled
    }
    return enabled && ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun showNotification(title: String, text: String, startedAtMs: Long) {
    if (!hasNotificationPermission()) {
      // Notifications are best-effort; the stopwatch itself must keep working.
      return
    }

    val manager = NotificationManagerCompat.from(context)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Running stopwatch",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Shows the elapsed time while a stopwatch is running"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        context,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(context.applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(startedAtMs)
      .setUsesChronometer(true)
      .setContentIntent(contentIntent)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setSilent(true)
      .build()

    try {
      manager.notify(NOTIFICATION_ID, notification)
    } catch (e: SecurityException) {
      // Permission revoked between the check and notify — ignore; best-effort.
    }
  }
}
