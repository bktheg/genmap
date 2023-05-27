import pg from 'pg'
import * as dotenv from 'dotenv'
import { consola } from 'consola'

dotenv.config()

let client = null

export function getClient():pg.Client {
    if( !client ) {
        client = new pg.Client()

        client.connect().then(() => {
            consola.debug(`Verbunden mit PostGIS ${client.database} auf ${client.host}:${client.port}`)
        }).catch(console.error)
    }
    return client;
}

