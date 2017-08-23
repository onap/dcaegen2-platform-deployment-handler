/*
Copyright(c) 2017 AT&T Intellectual Property. All rights reserved. 

Licensed under the Apache License, Version 2.0 (the "License"); 
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, 
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. 
See the License for the specific language governing permissions and limitations under the License.
*/

"use strict";

/**
 * Returns a promise for running and re-running the specified action until the result meets a specific condition
 *      - action is a function that returns a promise
 *      - predicate is a function that takes a success result from action and returns true if the action should be rerun
 *      - maxTries is the total number of times to try the action
 *      - interval is the interval, in milliseconds, between tries, as approximated by setTimeout()
 */

exports.repeatWhile = function(action, predicate, maxTries, interval) {
	return new Promise(function(resolve, reject) {
		
		var count = 0;
				
		function makeAttempt() {
			action()
			.then (function(res) {
				if (!predicate(res)) {
					// We're done
					resolve(res);
				}
				else {
					if (++count < maxTries) {
						// set up next attempt
						setTimeout(makeAttempt, interval);							
					}
					else {
						// we've run out of retries or it's not retryable, so reject the promise
						reject({message: "maximum repetions reached: " + count });				
					}
				}
			});
		}
		
		makeAttempt();
	});
};
