fx_version 'cerulean'
game 'gta5'

name 'varde_vehicles'
author 'Varde Framework contributors'
description 'Persistent vehicle ownership, keys, garages, and trunks for Varde'
version '0.1.0'
license 'MIT'

node_version '26'

dependencies {
    'varde_core',
    'varde_inventory'
}

files {
    'config/vehicles.json'
}

client_script 'client/main.lua'
server_script 'server.js'
