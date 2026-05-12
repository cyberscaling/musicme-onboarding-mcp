Pod::Spec.new do |s|
  s.name           = 'OfflineExpoModule'
  s.version        = '0.0.1'
  s.summary        = 'Expo wrapper for encrypted offline audio playback'
  s.author         = ''
  s.homepage       = 'https://github.com/cyberscaling/secure-audio-stream'
  s.platforms      = { :ios => '15.0' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.swift_version  = '6.0'
  s.frameworks     = 'AVFoundation', 'WebKit', 'Security'
  s.libraries      = 'sqlite3'

  s.source_files   = "**/*.{h,m,swift}"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }
end
