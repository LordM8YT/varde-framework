fx_version 'cerulean'
game 'gta5'

name 'varde_status'
author 'Varde Framework contributors'
description 'Persistent needs and HUD data provider for Varde Framework'
version '0.1.0'
license 'MIT'

node_version '26'

dependency 'varde_core'

files {
    'config/status.json'
}

client_script 'client/main.lua'
server_script 'server.js'
