var chai = require('chai');
var expect = chai.expect;
var unitConversion = require('../services/map/kataster/unitConversion');

function area(morgen, ruten, fuss) {
    return new unitConversion.Area(morgen, ruten, fuss);
}

describe('unitConversion.parseKlasseString()', function () {
    it('should parse a plain class number', function () {
        var result = unitConversion.parseKlasseString('1', area(3, 0, 0));

        expect(result.error).to.be.null;
        expect(result.klassenMap.size).to.equal(1);
        expect(result.klassenMap.get(1).equals(area(3, 0, 0))).to.be.true;
    });

    it('should parse a class number combined with a Roman numeral in parentheses', function () {
        var result = unitConversion.parseKlasseString('1 (III)', area(3, 0, 0));

        expect(result.error).to.be.null;
        expect(result.klassenMap.size).to.equal(1);
        expect(result.klassenMap.get(1).equals(area(3, 0, 0))).to.be.true;
    });

    it('should parse a class number with a Roman numeral without a space', function () {
        var result = unitConversion.parseKlasseString('3(IV)', area(1, 0, 0));

        expect(result.error).to.be.null;
        expect(result.klassenMap.size).to.equal(1);
        expect(result.klassenMap.get(3).equals(area(1, 0, 0))).to.be.true;
    });

    it('should reject a class number outside 1-5 even with a Roman numeral', function () {
        var result = unitConversion.parseKlasseString('6 (I)', area(1, 0, 0));

        expect(result.klassenMap).to.be.null;
        expect(result.error).to.equal('Ungültige Klasse: 6 (I)');
    });

    it('should reject a lowercase Roman numeral', function () {
        var result = unitConversion.parseKlasseString('1 (iii)', area(1, 0, 0));

        expect(result.klassenMap).to.be.null;
        expect(result.error).to.equal('Ungültige Klasse: 1 (iii)');
    });

    it('should reject an unparseable class value', function () {
        var result = unitConversion.parseKlasseString('abc', area(1, 0, 0));

        expect(result.klassenMap).to.be.null;
        expect(result.error).to.equal('Ungültige Klasse: abc');
    });

    it('should parse a composite class string with a remaining rest class', function () {
        var result = unitConversion.parseKlasseString('1.0.0m=1 rest 2', area(3, 0, 0));

        expect(result.error).to.be.null;
        expect(result.klassenMap.get(1).equals(area(1, 0, 0))).to.be.true;
        expect(result.klassenMap.get(2).equals(area(2, 0, 0))).to.be.true;
    });

    it('should reject a composite class string whose parts exceed the total area', function () {
        var result = unitConversion.parseKlasseString('5.0.0m=1 rest 2', area(3, 0, 0));

        expect(result.klassenMap).to.be.null;
        expect(result.error).to.equal('Ungültige Klasse: 5.0.0m=1 rest 2. Restfläche ist negativ');
    });
});
