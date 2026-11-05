var chai = require('chai');
var expect = chai.expect;
var calculatedBuilding = require('../services/map/kataster/calculatedBuilding');

describe('CalculatedBuilding', function () {
    it('should take bezeichnung, typ and hnr in that order (as passed by mapGenerator.calculateBuildings)', function () {
        var b = new calculatedBuilding.CalculatedBuilding(null, 1, '12', 'Kirche', 'Wohnhaus', '7½');

        expect(b.bezeichnung).to.equal('Kirche');
        expect(b.typ).to.equal('Wohnhaus');
        expect(b.hnr).to.equal('7½');
    });
});
