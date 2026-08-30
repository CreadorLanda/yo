Pod::Spec.new do |s|
  s.name           = 'CallKeepAlive'
  s.version        = '1.0.0'
  s.summary        = 'Keeps a call alive while the app is in the background.'
  s.description    = 'Configures and holds the AVAudioSession so audio survives backgrounding.'
  s.author         = 'Yo'
  s.homepage       = 'https://github.com/CreadorLanda/yo'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: 'https://github.com/CreadorLanda/yo' }
  s.static_framework = true
  s.license        = { :type => 'GPL-3.0', :text => 'See LICENSE' }

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
