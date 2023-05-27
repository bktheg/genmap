var chai = require('chai');
chai.use(require('chai-datetime'));
var expect = chai.expect;
var zeit = require('../services/utils/zeit');

function utcDate(year, month, day) {
    var expected = new Date(0);
    expected.setUTCFullYear(year, month-1, day);
    return expected;
}

describe('zeit.parse()', function () {
    it('should parse ...', function () {
        var text = '...';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.true;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.be.null;
        expect(result.getText()).to.equal(text);
    });

    it('should parse 1900', function () {
        var text = '1900';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1900, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 1826 u. früher', function () {
        var text = '1826 u. früher';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1826, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 18?8', function () {
        var text = '18?8';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1808, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 18..', function () {
        var text = '18..';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1800, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse n. 1850', function () {
        var text = 'n. 1850';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1851, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse n 1850', function () {
        var text = 'n 1850';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1851, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 1547-49', function () {
        var text = '1547-49';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.true;
        expect(result.getDate()).to.equalDate(utcDate(1547, 1, 1));
        expect(result.getDatumEnde()).to.equalDate(utcDate(1549, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 1719/24', function () {
        var text = '1719/24';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.true;
        expect(result.getDate()).to.equalDate(utcDate(1719, 1, 1));
        expect(result.getDatumEnde()).to.equalDate(utcDate(1724, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse um 1719/24', function () {
        var text = 'um 1719/24';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.true;
        expect(result.getDate()).to.equalDate(utcDate(1719, 1, 1));
        expect(result.getDatumEnde()).to.equalDate(utcDate(1724, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 1647-1649', function () {
        var text = '1647-1649';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.true;
        expect(result.getDate()).to.equalDate(utcDate(1647, 1, 1));
        expect(result.getDatumEnde()).to.equalDate(utcDate(1649, 1, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 03.1902', function () {
        var text = '03.1902';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1902, 3, 1));
        expect(result.getText()).to.equal(text);
    });

    it('should parse 24.12.1910', function () {
        var text = '24.12.1910';

        var result = zeit.parse(text);

        expect(result.isUnknown()).to.be.false;
        expect(result.isRange()).to.be.false;
        expect(result.getDate()).to.equalDate(utcDate(1910, 12, 24));
        expect(result.getText()).to.equal(text);
    });
});