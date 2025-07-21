# w2t/websocket to tcp

The data in websocket need to be packed in the way of shadowsocks or vless.

The constants in the code:
```
NAT64_PREFIX: str
DEFAULT_HTTP_CF_ADDRESS: str
DEFAULT_HTTP_CF_PORT: int
DEFAULT_HTTPS_CF_ADDRESS: str
DEFAULT_HTTPS_CF_PORT: int

LANDING_SERVERS: {}

TG_TOKENS: []
TG_ID: str

ENFORCE_LOG: bool
```

The search parameters:
```
HTTP_CF: an address like 0.0.0.0:80
HTTPS_CF: an address like 0.0.0.0:443
SNI_Proxy: an address like 0.0.0.0:443

NAT64_Out: anything or blank

log: anything or blank
```
