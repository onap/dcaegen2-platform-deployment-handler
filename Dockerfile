FROM node:6.10.3
MAINTAINER maintainer
ENV INSROOT  /opt/app
ENV APPUSER dh
RUN mkdir -p ${INSROOT}/${APPUSER}/lib \
 && mkdir -p ${INSROOT}/${APPUSER}/etc \
 && mkdir -p ${INSROOT}/${APPUSER}/log \
 && useradd -d ${INSROOT}/${APPUSER} ${APPUSER}
COPY *.js ${INSROOT}/${APPUSER}/
COPY *.json ${INSROOT}/${APPUSER}/
COPY *.yaml ${INSROOT}/${APPUSER}/
COPY lib ${INSROOT}/${APPUSER}/lib/
COPY etc/log4js.json ${INSROOT}/${APPUSER}/etc/log4js.json
WORKDIR ${INSROOT}/${APPUSER}
RUN npm install --only=production && chown -R ${APPUSER}:${APPUSER} ${INSROOT}/${APPUSER} && npm remove -g npm
USER ${APPUSER}
VOLUME ${INSROOT}/${APPUSER}/log
EXPOSE 8443
ENTRYPOINT ["/usr/local/bin/node", "deployment-handler.js"]
