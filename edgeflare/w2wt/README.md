# w2wt/websocket to wesocket or tcp

The server will connect to the address via the headers, and the transported data is in the websocket.

```
headers: {
  x-forward-host
  x-forward-port
  x-forward-path
  x-forward-protocol: ["tcp" | "tls" | "ws" | "wss"]
}
```
