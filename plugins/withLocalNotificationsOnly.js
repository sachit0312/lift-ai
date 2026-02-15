const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * Config plugin that removes the aps-environment entitlement added by expo-notifications.
 * This allows local notifications to work without requiring the Push Notifications
 * capability (which needs a paid Apple Developer account).
 *
 * MUST be listed AFTER expo-notifications in the plugins array so this mod runs last.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });
};
