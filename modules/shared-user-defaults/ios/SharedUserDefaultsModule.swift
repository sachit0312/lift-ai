import ExpoModulesCore

public class SharedUserDefaultsModule: Module {
  private let appGroupID = "group.com.sachitgoyal.liftai"

  public func definition() -> ModuleDefinition {
    Name("SharedUserDefaults")

    Function("setItem") { (key: String, value: String) in
      UserDefaults(suiteName: self.appGroupID)?.set(value, forKey: key)
    }

    Function("getItem") { (key: String) -> String? in
      return UserDefaults(suiteName: self.appGroupID)?.string(forKey: key)
    }

    Function("removeItem") { (key: String) in
      UserDefaults(suiteName: self.appGroupID)?.removeObject(forKey: key)
    }
  }
}
