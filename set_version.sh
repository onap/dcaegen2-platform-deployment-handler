#!/bin/bash

echo "exports.branch=\"$(git branch | grep \* | cut -d ' ' -f2)\";" > version.js
echo "exports.commit=\"$(git describe --long --always)\";" >> version.js
echo "exports.commit_datetime=\"$(git show -s --format=%ci)\";" >> version.js
