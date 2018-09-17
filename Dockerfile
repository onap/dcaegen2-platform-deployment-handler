FROM node:6.10.3

ENV INSROOT /opt/app
ENV APPUSER dh
ENV APPDIR ${INSROOT}/${APPUSER}

RUN mkdir -p ${APPDIR}/lib \
 && mkdir -p ${APPDIR}/etc \
 && mkdir -p ${APPDIR}/log \
 && useradd -d ${APPDIR} ${APPUSER}

COPY *.js ${APPDIR}/
COPY *.json ${APPDIR}/
COPY *.txt ${APPDIR}/
COPY *.yaml ${APPDIR}/
COPY ./lib/ ${APPDIR}/lib/
COPY ./etc/ ${APPDIR}/etc/

WORKDIR ${APPDIR}

RUN npm install --only=production \
 && chown -R ${APPUSER}:${APPUSER} ${APPDIR} \
 && npm remove -g npm \
 && ls -laR -Inode_modules

USER ${APPUSER}
VOLUME ${APPDIR}/log
EXPOSE 8443

ENTRYPOINT ["/usr/local/bin/node", "deployment-handler.js"]
