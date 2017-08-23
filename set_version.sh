#!/bin/bash
echo "exports.version=\"$(git describe --long --always)\";" > version.js
