fx_version 'cerulean'
game 'gta5'

name 'varde_identity'
author 'Varde Framework contributors'
description 'Character selection and identity UI for Varde Framework'
version '0.1.0'
license 'MIT'

dependency 'varde_core'

ui_page 'web/index.html'

files {
    'web/index.html',
    'web/styles.css',
    'web/app.js'
}

client_scripts {
    'config.lua',
    'client.lua'
}
