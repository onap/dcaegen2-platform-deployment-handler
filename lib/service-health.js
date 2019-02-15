/*
Copyright(c) 2017-2019 AT&T Intellectual Property. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

/* Handle the /servicehealth API which checks if inventory and cloudify are healthy*/

"use strict";

const app = require('express')();
app.set('x-powered-by', false);
app.set('etag', false);

const bodyParser = require('body-parser');
const inv = require('./inventory');
const log = require('./logging').getLogger();

/* Pick up config exported by main */
const config = process.mainModule.exports.config;
const inventory = inv({url: config.inventory.url});

var cfy = require("./cloudify.js");
/* Set config for interface library */
cfy.setAPIAddress(config.cloudify.url);
cfy.setCredentials(config.cloudify.user, config.cloudify.password);
cfy.setLogger(log);

app.use(bodyParser.json({strict: true}));				// Parse body as JSON
app.use(function (req, res, next) {
    log.info(req.dcaeReqId,
        "new req: " + req.method + " " + req.originalUrl +
        " from: " + req.ip + " body: " + JSON.stringify(req.body)
    );
    next();
});


/* Accept an incoming service health check request */
app.get('/', function (req, res, next) {

    /* Verify inventory service health*/
    inventory.isServiceHealthy(req)

    .then(function (isInvHealthy) {
        log.info(req.dcaeReqId,"Checking isServiceHealthy: " + isInvHealthy);
        if ( isInvHealthy === true) {
            log.info(req.dcaeReqId,"Inventory is healthy: ");
            return cfy.getCfyStatus(req)

                .then(function (cfyStatusResp) {
                    log.info(req.dcaeReqId,"getCfyStatus Response -> " + JSON.stringify(cfyStatusResp, 2));
                    if (cfyStatusResp.status === 200) {
                        var isCfyHealthy = true;
                        if ( cfyStatusResp.json && cfyStatusResp.json.status === "running" ) {
                            log.info(req.dcaeReqId,"getCfyStatus Response status is running: ");
                            const services = Object.keys(cfyStatusResp.json.services);
                            log.info(req.dcaeReqId,"getCfyStatus services.length -> " + services.length);
                            // run through all the cfy services to see which ones are running
                            // don't stop looping when a cfy service is down, it's better to see a list of all serivces' status
                            // so that we an idea about overall health of cfy
                            services.forEach( service => {
                                var service_display_name = cfyStatusResp.json.services[service].display_name;
                                const instances = Object.keys(cfyStatusResp.json.services[service].instances);
                                instances.forEach( instance => {
                                    var description = cfyStatusResp.json.services[service].instances[instance].Description;
                                    var subState = cfyStatusResp.json.services[service].instances[instance].SubState;
                                    log.info(req.dcaeReqId,"cfy status for service display_name: " + service_display_name
                                        + " and Description: " + description + " has a SubState of: " + subState);
                                    if ( subState !== "running" ) {
                                        log.info(req.dcaeReqId,"getCfyStatus Description-> " + description + " NOT running ok");
                                        isCfyHealthy = false;
                                        res.status(503).json({requestId: req.dcaeReqId, status: 'NOT OK'});
                                    }
                                });
                            });
                        }
                        if ( isCfyHealthy === true ) {
                            log.info(req.dcaeReqId,"Cloudify is healthy");
                            res.status(200).json({requestId: req.dcaeReqId, status: 'OK'});
                        }
                        else {
                            log.info(req.dcaeReqId,"Cloudify is not healthy");
                            res.status(503).json({requestId: req.dcaeReqId, status: 'NOT OK'});
                        }
                    } else {
                        log.info(req.dcaeReqId,"Cloudify is not healthy; responded with status " + cfyStatusResp.status);
                        res.status(503).json({requestId: req.dcaeReqId, status: 'NOT OK'});
                    }
                })
        }
        else {
            res.status(503).json({requestId: req.dcaeReqId, status: 'NOT OK'});
            log.info(req.dcaeReqId,"Inventory is not healthy");
        }
    })

     /* All errors show up here */

     .catch(function (error) {
         /* If we haven't already sent a response, let the error handler send response and log the error */
         if (!res.headersSent) {
                next(error);
         }
         else {
             /* Already sent the response, so just log error */
             error.message = "Error checking service health :" + error.message
                 + " " + (error.stack || "").replace(/\n/g, " ");
             log.error(error, req);
             log.audit(req, 500, error.message);
         }
     });
});

module.exports = app;
