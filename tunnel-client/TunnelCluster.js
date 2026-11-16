const { EventEmitter } = require('events');
const debug = require('debug')('localtunnel:client');
const fs = require('fs');
const net = require('net');
const tls = require('tls');

const HeaderHostTransformer = require('./HeaderHostTransformer');
const { connectViaProxy } = require('./proxy-https');

// PATCH (yetu-vfy): the sandbox egress is proxy-only (HTTP CONNECT). The
// tunnel server connection is a RAW TCP socket, so it cannot use an HTTPS
// proxy agent — instead we CONNECT through the proxy ourselves (auth from
// env, same as curl). Derived from localtunnel 2.0.2 (MIT), TunnelCluster.js.

// manages groups of tunnels
module.exports = class TunnelCluster extends EventEmitter {
  constructor(opts = {}) {
    super(opts);
    this.opts = opts;
  }

  open() {
    const opt = this.opts;

    // Prefer IP if returned by the server
    const remoteHostOrIp = opt.remote_ip || opt.remote_host;
    const remotePort = opt.remote_port;
    const localHost = opt.local_host || 'localhost';
    const localPort = opt.local_port;
    const localProtocol = opt.local_https ? 'https' : 'http';
    const allowInvalidCert = opt.allow_invalid_cert;

    debug(
      'establishing tunnel %s://%s:%s <> %s:%s',
      localProtocol,
      localHost,
      localPort,
      remoteHostOrIp,
      remotePort
    );

    // connection to localtunnel server (via the egress proxy when set)
    connectViaProxy(remoteHostOrIp, remotePort).then((remote) => {
      this._wireRemote(remote, { localHost, localPort, localProtocol, allowInvalidCert, opt });
      this.emit('open', remote);
    }).catch((err) => {
      debug('got remote connection error', err.message);
      // retry with a small backoff (the Tunnel re-opens on 'dead')
      setTimeout(() => this.emit('dead'), 1000);
    });
  }

  _wireRemote(remote, { localHost, localPort, localProtocol, allowInvalidCert, opt }) {
    // Short TCP keepalive so a silently-dropped connection (the egress proxy
    // kills idle TCP without FIN/RST) is detected and replaced, instead of
    // leaving a half-open socket that never fires 'close' and drains the pool.
    remote.setKeepAlive(true, 10000);

    remote.on('error', err => {
      debug('got remote connection error', err.message);

      // emit connection refused errors immediately, because they
      // indicate that the tunnel can't be established.
      if (err.code === 'ECONNREFUSED') {
        this.emit(
          'error',
          new Error(
            `connection refused: ${opt.remote_ip || opt.remote_host}:${opt.remote_port} (check your firewall settings)`
          )
        );
      }

      remote.end();
    });

    const connLocal = () => {
      if (remote.destroyed) {
        debug('remote destroyed');
        this.emit('dead');
        return;
      }

      debug('connecting locally to %s://%s:%d', localProtocol, localHost, localPort);
      remote.pause();

      if (allowInvalidCert) {
        debug('allowing invalid certificates');
      }

      const getLocalCertOpts = () =>
        allowInvalidCert
          ? { rejectUnauthorized: false }
          : {
              cert: fs.readFileSync(opt.local_cert),
              key: fs.readFileSync(opt.local_key),
              ca: opt.local_ca ? [fs.readFileSync(opt.local_ca)] : undefined,
            };

      // connection to local http server
      const local = opt.local_https
        ? tls.connect({ host: localHost, port: localPort, ...getLocalCertOpts() })
        : net.connect({ host: localHost, port: localPort });

      const remoteClose = () => {
        debug('remote close');
        this.emit('dead');
        local.end();
      };

      remote.once('close', remoteClose);

      // TODO some languages have single threaded servers which makes opening up
      // multiple local connections impossible. We need a smarter way to scale
      // and adjust for such instances to avoid beating on the door of the server
      local.once('error', err => {
        debug('local error %s', err.message);
        local.end();

        remote.removeListener('close', remoteClose);

        if (err.code !== 'ECONNREFUSED') {
          return remote.end();
        }

        // retrying connection to local server
        setTimeout(connLocal, 1000);
      });

      local.once('connect', () => {
        debug('connected locally');
        remote.resume();

        let stream = remote;

        // if user requested specific local host
        // then we use host header transform to replace the host header
        if (opt.local_host) {
          debug('transform Host header to %s', opt.local_host);
          stream = remote.pipe(new HeaderHostTransformer({ host: opt.local_host }));
        }

        stream.pipe(local).pipe(remote);

        // when local closes, also get a new remote
        local.once('close', hadError => {
          debug('local connection closed [%s]', hadError);
        });
      });
    };

    remote.on('data', data => {
      const match = data.toString().match(/^(\w+) (\S+)/);
      if (match) {
        this.emit('request', {
          method: match[1],
          path: match[2],
        });
      }
    });

    // tunnel is considered open when remote connects
    connLocal();
  }
};
