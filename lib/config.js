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

/*
 * Dispatcher configuration
 * Configuration may come from environment variables, a value in a Consul key-value store, or defaults,
 * in that order of precedence.
 *
 * The url of the Consul is passed in an optional environment variable called CONSUL_URL.
 * If $CONSUL_URL not provided, the deployment-handler looks at the Consul host that can be passed
 * in as an environment variable called CONSUL_HOST, that corresponds to url "http://${CONSUL_HOST}:8500".
 * If $CONSUL_HOST not provided as well, the consul url is "http://consul:8500".
 * If present, the configuration value in the consul-key-value store is a UTF-8 serialization of a JSON object.
 *
 *
 * --------------------------------------------------------------------------------------
 * | JSON property         | Environment variable   | Required? | Default               |
 * --------------------------------------------------------------------------------------
 * | logLevel              | LOG_LEVEL              | Yes       | "INFO"                |
 * --------------------------------------------------------------------------------------
 * | listenHost            | LISTEN_HOST            | Yes       | "0.0.0.0"             |
 * --------------------------------------------------------------------------------------
 * | listenPort            | LISTEN_PORT            | Yes       | 8443                  |
 * --------------------------------------------------------------------------------------
 * | cloudify.user         | CLOUDIFY_USER          | No        | none                  |
 * --------------------------------------------------------------------------------------
 * | cloudify.password     | CLOUDIFY_PASSWORD      | No        | none                  |
 * --------------------------------------------------------------------------------------
 * | cloudify.protocol     | CLOUDIFY_PROTOCOL      | No        | "https"               |
 * --------------------------------------------------------------------------------------
 * | inventory.user        | INVENTORY_USER         | No        | none                  |
 * --------------------------------------------------------------------------------------
 * | inventory.password    | INVENTORY_PASSWORD     | No        | none                  |
 * --------------------------------------------------------------------------------------
 * | inventory.protocol    | INVENTORY_PROTOCOL     | No        | "https"               |
 * --------------------------------------------------------------------------------------
 * | auth                  | (no environment var)   | No        | none                  |
 * --------------------------------------------------------------------------------------
 * | useConsul             | USE_CONSUL             | No        | TRUE                  |
 * --------------------------------------------------------------------------------------
 *
 * auth, if present, is a JSON object, with property names corresponding to user names and
 * property values corresponding to passwords.  If the auth property has the value:
 * {"admin" : "admin123", "other" : "other123"}, then any incoming HTTP requests must use
 * Basic authentication and supply "admin" as a user name with "admin123" as the password or
 * supply "other" as the user name with "other123" as the password.
 *
 * useConsul will control whether to go out to consul to get inventory and cloudify location
 * and credentails. If set to false, need to provide inventory/cloudify info via environment
 * variables.
 *
 * The deployment-handler will attempt to run its web-server using TLS (i.e., as an HTTPS server)
 * if a certificate file in pkcs12 format is stored at etc/cert/cert and a file containing the
 * corresponding passphrase is stored at etc/cert/pass.
 *   - alternative files can be at etc/cert/cert.p12 and etc/cert/p12.pass, respectively.
 * These files can be made available to the container running the deployment-handler by
 * mounting a volume to the container.
 */
"use strict";

const fs = require("fs");
const utils = require("./utils");
const consul = require("./consul");
var useConsul = 'TRUE';

const SSL_CERT_FILE = "etc/cert/cert";
const SSL_PASS_FILE = "etc/cert/pass";
const SSL_CERT_P12_FILE = "etc/cert/cert.p12";
const SSL_P12_PASS_FILE = "etc/cert/p12.pass";

const PACKAGE_JSON_FILE = "./package.json";

const CONFIG_KEY = "deployment_handler";	/* Configuration is stored under the name "deployment_handler" */
const CM_NAME = "cloudify_manager";
const INV_NAME = "inventory";

//const CM_API_PATH = "/api/v2.1";
const CM_API_PATH = "/api/v3.1";
const INV_API_PATH = "";

const DEFAULT_CLOUDIFY_PROTOCOL = "https";
const DEFAULT_INVENTORY_PROTOCOL = "https";
const DEFAULT_LISTEN_PORT = 8443;
const DEFAULT_LISTEN_HOST = "0.0.0.0";
const DEFAULT_LOG_LEVEL = "INFO";

/* Check configuration for completeness */
const findMissingConfig = function(cfg) {
	const requiredProps = ['logLevel', 'listenHost', 'listenPort', 'cloudify.url', 'inventory.url'];
	return requiredProps.filter(function(p){return !utils.hasProperty(cfg,p);});
};

/* Fetch configuration */
const getConfig = function() {
    if ( useConsul === 'FALSE' ) {
    	return {};
    }
    else {
        return consul.getKey(CONFIG_KEY)
            .then(function (res) {
                return res || {};
            })
            .catch(function (err) {
                throw err;
            });
    }
};


/* Get a service host:port */
const getService = function (serviceName) {
    if ( useConsul === 'FALSE' ) {
    	if ( serviceName === CM_NAME ) {
            const cloudifyConfig = JSON.parse(process.env.CLOUDIFY);
            /* return {address: process.env.CLOUDIFY_ADDRESS, port: process.env.CLOUDIFY_PORT, url: ""}; */
            return {address: cloudifyConfig.cloudify.address, port: cloudifyConfig.cloudify.port,
					user: cloudifyConfig.cloudify.user, password: cloudifyConfig.cloudify.password,
					protocol: cloudifyConfig.cloudify.protocol, url: ""};
			//return JSON.parse(process.env.CLOUDIFY);
		}
        else if ( serviceName === INV_NAME ) {
            /* return {address: process.env.INVENTORY_SERVICE_SERVICE_HOST , port: process.env.INVENTORY_SERVICE_SERVICE_PORT, url: ""}; */
            return {address: process.env.INVENTORY_SERVICE_NAME + "." + process.env.NAMESPACE + process.env.INVENTORY_SERVICE_NAME_SUFFIX ,
                    port: process.env.INVENTORY_SERVICE_SERVICE_PORT, url: ""};
        }
		else {
            return {};
		}
    }
    else {
        return consul.getService(serviceName)
            .then(function (res) {
                if (res.length > 0) {
                    return res[0];
                }
                else {
                    throw new Error("No service address found for " + serviceName);
                }
            })
    }
};

/* Get the content of a file */
const getFileContents = function(path) {
    return new Promise(function(resolve, reject) {
        fs.readFile(path, function(err, data) {
            if (err) {
                reject(err);
            }
            else {
                resolve(data);
            }
        })
    })
};

/* Check for a TLS cert file and passphrase */
const getTLSCredentials = function(ssl_pass_file, ssl_cert_file) {
	const ssl = {};

	/* Get the passphrase */
	return getFileContents(ssl_pass_file)
	.then(function(phrase) {
		ssl.passphrase = phrase.toString('utf8').trim();

		/* Get the cert */
		return getFileContents(ssl_cert_file);
	})

	.then(function(cert) {
		ssl.pfx = cert;   /* Keep cert contents as a Buffer */
		return ssl;
	})

	.catch(function(err) {
		console.log((new Date()) + ": getTLSCredentials", err.toString());
		return;
	});
};

exports.configure = function() {
	const config = {};
	config.server_instance_uuid = utils.generateId();

	/* Get configuration from configuration store */
	return getFileContents(PACKAGE_JSON_FILE)
	.then(function(package_json) {
		package_json = JSON.parse((package_json || "{}").toString('utf8'));

		config.name = package_json.name;
		config.description = package_json.description;
		config.version = package_json.version || "";
		const ver = require('../version');
		config.branch = ver.branch || "";
		config.commit = ver.commit || "";
		config.commit_datetime = ver.commit_datetime || "";

        if ( process.env.USE_CONSUL ) {
            useConsul = process.env.USE_CONSUL;
        }
        config.useConsul = useConsul;

        console.log( (new Date()) + ": config.configure(): useConsul " + useConsul );

		return getConfig();
	})
	.then (function(cfg) {
		Object.assign(config, cfg);

		/* Override values with environment variables and set defaults as needed */
		config.listenPort = process.env.LISTEN_PORT || cfg.listenPort || DEFAULT_LISTEN_PORT;
		config.listenHost = process.env.LISTEN_HOST || cfg.listenHost || DEFAULT_LISTEN_HOST;
		config.logLevel = process.env.LOG_LEVEL || cfg.logLevel || DEFAULT_LOG_LEVEL;

		config.cloudify = config.cloudify || {};
		config.cloudify.protocol = process.env.CLOUDIFY_PROTOCOL || (cfg.cloudify && cfg.cloudify.protocol) || DEFAULT_CLOUDIFY_PROTOCOL;
		if ((cfg.cloudify && cfg.cloudify.user) || process.env.CLOUDIFY_USER) {
			config.cloudify.user = process.env.CLOUDIFY_USER || cfg.cloudify.user;
			config.cloudify.password = process.env.CLOUDIFY_PASSWORD || cfg.cloudify.password || "";
		}

		config.inventory = config.inventory || {};
		config.inventory.protocol = process.env.INVENTORY_PROTOCOL || (cfg.inventory && cfg.inventory.protocol) || DEFAULT_INVENTORY_PROTOCOL;
		if ((cfg.inventory && cfg.inventory.user)|| process.env.INVENTORY_USER) {
			config.inventory.user = process.env.INVENTORY_USER || cfg.inventory.user;
			config.inventory.password = process.env.INVENTORY_PASSWORD || cfg.inventory.password || "";
		}

		/* Get service information for Cloudify Manager */
		return getService(CM_NAME);
	})

	.then(function(cmService) {
		if ( useConsul === 'FALSE' ) {
			if (cmService.protocol) {
				config.cloudify.protocol = cmService.protocol;
			}
			if (cmService.user) {
				config.cloudify.user = cmService.user;
			}
			if (cmService.password) {
				config.cloudify.password = cmService.password;
			}
		}
		config.cloudify.url = config.cloudify.protocol +"://" + cmService.address + ":" + cmService.port + CM_API_PATH;

		/* Get service information for inventory */
		return getService(INV_NAME);
	})

    .then(function(invService) {
		config.inventory.url = config.inventory.protocol + "://" + invService.address + ":" + invService.port + INV_API_PATH;

		console.log((new Date()) + ": looking for tls files", SSL_PASS_FILE, SSL_CERT_FILE);
		return getTLSCredentials(SSL_PASS_FILE, SSL_CERT_FILE);
	})
	.then(function(tls) {
		if (tls) {return tls;}

		console.log((new Date()) + ": looking for alternative tls files", SSL_P12_PASS_FILE, SSL_CERT_P12_FILE);
		return getTLSCredentials(SSL_P12_PASS_FILE, SSL_CERT_P12_FILE);
	})
	.then(function(tls) {
		if (tls) {config.ssl = tls;}

		/* Check for missing required configuration parameters */
		const missing = findMissingConfig(config);
		if (missing.length > 0) {
			throw new Error ("Required configuration elements missing: " + missing.join(','));
			config = null;
		}
		console.log((new Date()) + ": config -> " + JSON.stringify(config, utils.hideSecrets, 2));
		return config;
	});
};
