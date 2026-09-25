package expo.modules.sillagedevice

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ce que react-native-health-connect n'expose pas, en lecture seule :
 * - la disponibilité de la lecture en arrière-plan dans la version installée de Health Connect
 *   (sur Android 13 et moins, l'appli Health Connect du Play Store doit être assez récente) ;
 * - l'état de l'optimisation de batterie et de la restriction d'arrière-plan pour Sillage.
 */
class SillageDeviceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SillageDevice")

    // "available", "unavailable", "sdk-unavailable" (Health Connect absent ou à mettre à jour)
    // ou "unknown" (pas de contexte).
    Function("backgroundReadFeature") {
      val context = appContext.reactContext
      if (context == null) {
        "unknown"
      } else if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
        "sdk-unavailable"
      } else {
        val status = HealthConnectClient.getOrCreate(context)
          .features
          .getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)
        if (status == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) "available" else "unavailable"
      }
    }

    // true : Sillage est exclue de l'optimisation de batterie ; null : inconnu.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext
      val power = context?.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (context == null || power == null) null else power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // true : batterie « Restreinte » (Android 9+), les tâches de fond ne tournent pas ; null : inconnu.
    Function("isBackgroundRestricted") {
      val context = appContext.reactContext
      val activity = context?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) null else activity.isBackgroundRestricted
    }
  }
}
