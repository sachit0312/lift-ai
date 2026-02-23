import ExpoModulesCore

public class SharedUserDefaultsModule: Module {
  private let appGroupID = "group.com.sachitgoyal.liftai"

  public func definition() -> ModuleDefinition {
    Name("SharedUserDefaults")

    Function("setItem") { (key: String, value: String) in
      let defaults = UserDefaults(suiteName: self.appGroupID)
      defaults?.set(value, forKey: key)
      defaults?.synchronize()
    }

    Function("getItem") { (key: String) -> String? in
      let defaults = UserDefaults(suiteName: self.appGroupID)
      defaults?.synchronize()
      return defaults?.string(forKey: key)
    }

    Function("removeItem") { (key: String) in
      let defaults = UserDefaults(suiteName: self.appGroupID)
      defaults?.removeObject(forKey: key)
      defaults?.synchronize()
    }
  }
}
