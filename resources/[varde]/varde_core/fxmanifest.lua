fx_version 'cerulean'
game 'gta5'

name 'varde_core'
author 'Varde Framework contributors'
description 'Varde Framework core for FiveM Enhanced'
version '0.1.0'
license 'MIT'

-- FiveM for GTAV Enhanced ships with Node 26 on the server.
node_version '26'

dependencies {
    '/onesync'
}

files {
    'config/defaults.json'
}

client_script 'client/main.lua'
server_script 'server/main.js'
