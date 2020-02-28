# ========================================================================
# Copyright (c) 2017-2020 AT&T Intellectual Property. All rights reserved.
# ========================================================================
# Unless otherwise specified, all software contained herein is licensed
# under the Apache License, Version 2.0 (the "License");
# you may not use this software except in compliance with the License.
# You may obtain a copy of the License at
#
#             http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ============LICENSE_END=================================================

FROM node:10.16-alpine

ENV INSROOT /opt/app
ENV APPUSER dh
ENV APPDIR ${INSROOT}/${APPUSER}

COPY *.js ${APPDIR}/
COPY *.json ${APPDIR}/
COPY *.txt ${APPDIR}/
COPY *.yaml ${APPDIR}/
COPY ./lib/ ${APPDIR}/lib/
COPY ./etc/ ${APPDIR}/etc/

WORKDIR ${APPDIR}

RUN npm install --production \
 && mkdir -p ${APPDIR}/log \
 && addgroup ${APPUSER} \
 && adduser -S -h ${APPDIR} -G ${APPUSER} ${APPUSER} \
 && chown -R ${APPUSER}:${APPUSER} ${APPDIR} \
 && npm remove -g npm \
 && ls -la

USER ${APPUSER}
VOLUME ${APPDIR}/log
EXPOSE 8443

ENTRYPOINT ["/usr/local/bin/node", "deployment-handler.js"]
