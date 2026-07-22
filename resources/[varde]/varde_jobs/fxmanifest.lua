fx_version 'cerulean'
game 'gta5'

name 'varde_jobs'
author 'Varde Framework contributors'
description 'Jobs, grades, duty, and permissions for Varde Framework'
version '0.1.0'
license 'MIT'

node_version '26'

dependency 'varde_core'

files {
    'config/jobs.json'
}

client_script 'client/main.lua'
server_script 'server.js'
