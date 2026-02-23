require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SharedUserDefaults'
  s.version        = package['version']
  s.summary        = 'Expo module for App Groups UserDefaults'
  s.description    = 'Provides shared UserDefaults access via App Groups for widget communication'
  s.license        = 'MIT'
  s.author         = 'Sachit Goyal'
  s.homepage       = 'https://github.com/sachitgoyal/lift-ai'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/sachitgoyal/lift-ai' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
