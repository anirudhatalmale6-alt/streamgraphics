global.window = {};
require(__dirname + '/../../public/sg-qr.js');
const cases = JSON.parse(process.argv[2]);
console.log(JSON.stringify(cases.map(c => global.window.SGQR.svg(c.text, { level: c.level }))));
