'use strict';

const express = require('express');
const app = express();
const fs = require('fs');
const http = require('http');
const MongoClient = require('mongodb').MongoClient;
const urlencodedParser = require('body-parser').urlencoded({extended: true});
const templateHtml = fs.readFileSync('templates/template.html', 'utf8');
const boardingHtml = fs.readFileSync('templates/boarding.html_', 'utf8');
const registerHtml = fs.readFileSync('templates/register.html_', 'utf8');
const MONTH = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];
require('dotenv').config();

const ledGreenBlink = function () {
    return new Promise((resolve) => {
        http.get(process.env.FINGER_VEIN_API + '/api/ledgreenblink', (res) => {
            res.resume();
            resolve();
        });
    });
}

const ledGreenOn = function () {
    return new Promise((resolve) => {
        http.get(process.env.FINGER_VEIN_API + '/api/ledgreenon', (res) => {
            res.resume();
            resolve();
        });
    });
};

const mongoClient = new MongoClient(process.env.DB_URL, { useNewUrlParser: true});
let dB_Collection;

(async () => {
    await mongoClient.connect();
    console.log('DB server connected.');
    dB_Collection = mongoClient.db(process.env.DB_NAME).collection(process.env.COLLECTION_NAME);
})();


http.get(process.env.FINGER_VEIN_API + '/api/ledgreenon', (res) => {
    res.resume();
});

app.use(express.static('views'));

app.get('/', function (req, res) {
    res.send(templateHtml
        .replace(/{THIS_URL}/g, process.env.THIS_URL)
        .replace(/{NAV_PLACEHOLDER}/, `
            <li onclick="register()">Register</li>
            <li onclick="logIn()">Login</li>
        `)
        .replace(/{MAIN_PLACEHOLDER}/, '<figure><img id="cover-img" src="https://res.cloudinary.com/woooanet/image/upload/v1540199193/hitachi-fingervein-fe/brandingimg_vid_e.jpg" /></figure>')
    );
});

app.get('/login', (req, resp) => {
    let verification_1toN = function () {
        return new Promise(async (resolve, reject) => {
            await ledGreenBlink();
            console.log('Calling finger vein verification 1 to N API.');
            let data = '';

            http.get(process.env.FINGER_VEIN_API + '/api/verification_1toN', (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', async () => {
                    await ledGreenOn();
                    if (JSON.parse(data).response === 'ok') {
                        resolve(JSON.parse(data).verifiedTemplateNumber);
                    }
                    else {
                        reject('Finger vein not recognized.');
                    }
                });
            });
        });
    };

    let loadBoardingPass = function (verifiedTemplateNumber) {
        return new Promise((resolve, reject) => {
            console.log('Loading boarding pass.');
            dB_Collection.findOne({'verifiedTemplateNumber': verifiedTemplateNumber}, (err, boardingPass) => {
                if (boardingPass) {
                    resolve(boardingPass);
                }
                else {
                    reject('Boarding pass not found.');
                }
            });
        });
    };

    (async () => {
        try {
            const verifiedTemplateNumber = await verification_1toN();
            const boardingPass = await loadBoardingPass(verifiedTemplateNumber);

            console.log('Showing boarding pass.');
            let flightDateObj = new Date(boardingPass.time);
            let boardingDateObj = new Date(flightDateObj - 1000 * 60 * 30);     // flight time minus 30 mins
            resp.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, '<li>Hello, ' + boardingPass.name + '!</li><li><a href="' + process.env.THIS_URL + '/logout">Logout</a></li>')
                .replace(/{MAIN_PLACEHOLDER}/, boardingHtml)
                .replace(/{NAME}/g, boardingPass.name.toUpperCase())
                .replace(/{FROM-LONG}/g, boardingPass.fromLong.toUpperCase())
                .replace(/{FLIGHT}/g, boardingPass.flight)
                .replace(/{TO-LONG}/g, boardingPass.toLong.toUpperCase())
                .replace(/{MMM}/g, MONTH[flightDateObj.getMonth()])
                .replace(/{DD}/g, flightDateObj.getDate().toString().padStart(2, '0'))
                .replace(/{YYYY}/g, flightDateObj.getFullYear())
                .replace(/{HH}/g, flightDateObj.getHours().toString().padStart(2, '0'))
                .replace(/{MM}/g, flightDateObj.getMinutes().toString().padStart(2, '0'))
                .replace(/{GATE}/g, boardingPass.gate)
                .replace(/{BHH}/g, boardingDateObj.getHours().toString().padStart(2, '0'))
                .replace(/{BMM}/g, boardingDateObj.getMinutes().toString().padStart(2, '0'))
                .replace(/{FROM-SHORT}/g, boardingPass.fromShort)
                .replace(/{TO-SHORT}/g, boardingPass.toShort)
                .replace(/{SEAT}/g, boardingPass.seat)
            );
        }
        catch (err) {
            console.log('Error: ', err);
            resp.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, `
                    <li onclick="register()">Register</li>
                    <li onclick="logIn()">Login</li>
                `)
                .replace(/{MAIN_PLACEHOLDER}/, '<p id="error">Sorry, ' + err.toLowerCase() + '</p>')
            );
        }
    })();
});

app.get('/logout', function (req, res) {
    res.redirect('/');
});

app.get('/register', (req, resp) => {
    const receiveTemplate = function() {
        return new Promise(async (resolve, reject) => {
            await ledGreenBlink();
            console.log('Calling finger vein receive template API.');
            let data = '';

            http.get(process.env.FINGER_VEIN_API + '/api/receive_template', (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', async() => {
                    await ledGreenOn();
                    if (JSON.parse(data).response === 'ok') {
                        resolve({'template': JSON.parse(data).template});
                    }
                    else {
                        reject('Finger vein not recognized.');
                    }
                });
            });
        });
    };

    const sendTemplate = function(templateObj) {
        return new Promise(async (resolve, reject) => {
            console.log('Calling finger vein send template API.');
            let data = '';

            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            };

            const requ = http.request(process.env.FINGER_VEIN_API + '/api/send_template', options, (res) => {
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', async() => {
                    if (JSON.parse(data).response === 'ok') {
                        resolve(JSON.parse(data).templateNumber);
                    }
                    else {
                        reject('Finger vein not recognized.');
                    }
                });
            });

            requ.write(JSON.stringify(templateObj));
            requ.end();
        });
    };

    (async () => {
        try {
            const templateObj = await receiveTemplate();
            const templateNumber = await sendTemplate(templateObj);

            console.log('Showing registration page.');
            resp.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, `
                    <li onclick="register()">Register</li>
                    <li onclick="logIn()">Login</li>
                `)
                .replace(/{MAIN_PLACEHOLDER}/, registerHtml)
                .replace(/{TEMPLATE_NUMBER}/, templateNumber)
            );
        }
        catch (err) {
            console.log('Error: ', err);
            resp.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, `
                    <li onclick="register()">Register</li>
                    <li onclick="logIn()">Login</li>
                `)
                .replace(/{MAIN_PLACEHOLDER}/, '<p id="error">Sorry, ' + err.toLowerCase() + '</p>')
            );
        }
    })();
});

app.post('/submit', urlencodedParser, (req, res) => {
    (async () => {
        try {
            await dB_Collection.findOneAndReplace({
                'verifiedTemplateNumber': parseInt(req.body['template-number-input'], 10)
            }, {
                'verifiedTemplateNumber': parseInt(req.body['template-number-input'], 10),
                'name': req.body['name-input'],
                'fromLong': req.body['from-long-input'],
                'fromShort': req.body['from-short-input'],
                'toLong': req.body['to-long-input'],
                'toShort': req.body['to-short-input'],
                'flight': req.body['flight-input'],
                'time': req.body['time-input'],
                'gate': req.body['gate-input'],
                'seat': req.body['seat-input']
            }, {
                'upsert': true
            });

            res.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, `
                    <li onclick="register()">Register</li>
                    <li onclick="logIn()">Login</li>
                `)
                .replace(/{MAIN_PLACEHOLDER}/, '<p id="register">Registration succeeded.</p>')
            );
        }
        catch (err) {
            console.log('Error: ', err);
            resp.send(templateHtml
                .replace(/{THIS_URL}/g, process.env.THIS_URL)
                .replace(/{NAV_PLACEHOLDER}/, `
                    <li onclick="register()">Register</li>
                    <li onclick="logIn()">Login</li>
                `)
                .replace(/{MAIN_PLACEHOLDER}/, '<p id="error">Sorry, ' + err.toLowerCase() + '</p>')
            );
        }
    })();
});

process.on('SIGINT', async () => {
    await mongoClient.close();
    http.get(process.env.FINGER_VEIN_API + '/api/ledgreenoff', (res) => {
        res.resume();
        process.exit();
    });
});

const listener = app.listen(process.env.PORT, function() {
    console.log('Listening on port ' + listener.address().port);
});
