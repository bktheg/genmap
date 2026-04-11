import express from 'express';
import * as path from 'path';
import logger from 'morgan';
import vectortiles from '#services/preview/vectortiles';

const katasterPath = process.env.KATASTER_PATH
const port = process.env.PREVIEW_PORT || 9000

export function start():void {
    var app = express();

    console.log(process.cwd())

    app.use(function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });

    app.use(logger('dev'));
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(express.static(katasterPath+'/out_metadata'));
    app.use('/tilejson.json', express.static('public/tilejson.json'));
    app.use('/tiles', vectortiles);

    app.listen(port, () => {
        console.log(`Preview listening on port ${port}`)
    })
}