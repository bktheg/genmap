//import 'module-alias/register.js'
import * as dotenv from 'dotenv'
import { consola, LogLevels } from "consola";
import { CustomFancyReporter } from '#src/customReporter';
setup();

import * as yargs from 'yargs'
import * as chalk from 'chalk'
import * as mapGenerator from '#kataster/mapGenerator'
import * as mapValidator from '#kataster/mapValidator'
import * as autoLayerGenerator from '#kataster/autoLayerGenerator'
import * as urkatasterInfoGenerator from '#kataster/urkatasterInfoGenerator'
import * as gemeindeType from '#kataster/gemeindeType'
import { hideBin } from 'yargs/helpers'
import { getClient } from '#utils/database'

const parsedArgs = yargs.default(hideBin(process.argv))
.command('prepare [gemeinde]', 'Bereitet die Rohdaten aus QGIS für die Kartengenerierung vor für eine bestimmte Gemeinde oder alle Gemeinden', (yargs) => {
    return yargs
        .positional('gemeinde', {
            describe: 'Gemeinde ID',
            default: ''
        })
    }, async (argv) => {
        setLogLevel(argv.verbose)
        consola.start('Vorverarbeitung für Gemeinde', argv.gemeinde || '*')
        await autoLayerGenerator.generateAutoLayer(argv.gemeinde ? gemeindeType.forId(argv.gemeinde) : null)
        consola.success('fertig')
    }
)
.command('generate [gemeinde]', 'Generiert die Karte aus den vorverarbeiteten Rohdaten für eine bestimmte Gemeinde oder alle Gemeinden', (yargs) => {
    return yargs
        .positional('gemeinde', {
            describe: 'Gemeinde ID',
            default: ''
        })
        .option('writeAllPoints', {
            type: 'boolean',
            description: 'Sollen wirklich alle Punkte geschrieben werden statt nur der Punkte des Netzes?',
            default: false
        })
    }, async (argv) => {
        setLogLevel(argv.verbose)
        consola.start('Erzeuge Karte für Gemeinde', argv.gemeinde || '*')
        await mapGenerator.generateMap(argv.gemeinde ? gemeindeType.forId(argv.gemeinde) : null, argv.writeAllPoints)
        consola.success('fertig')
    }
)
.command('map [gemeinde]', 'Bereitet die Rohdaten vor und generiert die Karte für eine bestimmte Gemeinde oder alle Gemeinden', (yargs) => {
    return yargs
        .positional('gemeinde', {
            describe: 'Gemeinde ID',
            default: ''
        })
        .option('writeAllPoints', {
            type: 'boolean',
            description: 'Sollen wirklich alle Punkte geschrieben werden statt nur der Punkte des Netzes?',
            default: false
        })
    }, async (argv) => {
        setLogLevel(argv.verbose)
        consola.start('Vorverarbeitung für Gemeinde', argv.gemeinde || '*')
        await autoLayerGenerator.generateAutoLayer(argv.gemeinde ? gemeindeType.forId(argv.gemeinde) : null)
        consola.start('Erzeuge Karte für Gemeinde', argv.gemeinde || '*')
        await mapGenerator.generateMap(argv.gemeinde ? gemeindeType.forId(argv.gemeinde) : null, argv.writeAllPoints)
        consola.success('fertig')
    }
)
.command('generate-net', 'Generiert das Vermessungsnetz aus den abgeschriebenen Vermessungsdateien', () => {}, async (argv) => {
    setLogLevel(argv.verbose)
    consola.start('Berechne Vermessungsnetz')
    await mapGenerator.generateNet()
    consola.success('fertig')
})
.command('generate-info', 'Generiert die Zusatzinfos zur Karte neu (Eigentümer usw)', () => {}, async (argv) => {
    setLogLevel(argv.verbose)
    consola.start('Berechne Zusatzinfos')
    await urkatasterInfoGenerator.generateUrkatasterInfo(null)
    consola.success('fertig')
})
.command('metadata', 'Erzeugt die Metadaten zur Karte (Jsons, Gemeindedefinitionen, Grenzen)', () => {}, async (argv) => {
    setLogLevel(argv.verbose)
    consola.start('Erzeuge Metadaten')
    await mapGenerator.generateMetadata()
    consola.success('fertig')
})
.command('validate', 'Erzeugt die Metadaten zur Karte (Jsons, Gemeindedefinitionen, Grenzen)', () => {}, async (argv) => {
    setLogLevel(argv.verbose)
    consola.start('Validiere')
    await mapValidator.validateMap()
    consola.success('fertig')
})
.option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Aktiviert zusätzliche Logausgaben',
})
.parseAsync()

parsedArgs.then(() => getClient().end())


function setLogLevel(verbose:unknown):void {
    consola.level = verbose ? LogLevels.verbose : LogLevels.info
}

function setup() {
    dotenv.config()
    consola.setReporters([new CustomFancyReporter()])
}