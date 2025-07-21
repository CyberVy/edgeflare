Deno.serve(async (request,info) => {

    try {
        let upgradeHeader = request.headers.get('upgrade')
        if (!upgradeHeader || upgradeHeader !== 'websocket') {
            let url = new URL(request.url)
            url.protocol = "http"
            url.host = "162.159.136.1"
            return await fetch(url)
        }
        else {
            return await main(request,info)
        }
    }
    catch (error){
        console.log(error)
        return new Response(null)
    }
})

function makeReadableWebSocketStream(websocket,secWebsocketProtocol) {

    function base64StrToUint8Array(base64Str) {

        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/')
        return  Uint8Array.from(atob(base64Str), (c) => c.charCodeAt(0)).buffer
    }

    let secWebsocketProtocolArray
    return new ReadableStream({
        start(controller) {
            websocket.addEventListener('message', async message => {
                try {
                    if (message.data.stream){
                        controller.enqueue((await message.data.stream().getReader().read()).value)
                    }
                    else{
                        controller.enqueue(message.data)
                    }
                }
                catch {}
            })
            websocket.addEventListener('close', () => {
                try {
                    controller.close()
                }
                catch {}
            })
            websocket.addEventListener('error', (error) => {
                // console.log(`Websocket error: ${error.message}`)
            })
            if (secWebsocketProtocol){
                try{
                    secWebsocketProtocolArray = base64StrToUint8Array(secWebsocketProtocol)
                    controller.enqueue(secWebsocketProtocolArray)
                }
                catch (secWebsocketProtocolArrayTransformingError){
                    controller.error(secWebsocketProtocolArrayTransformingError)
                }
            }
        },
        cancel(reason) {
            console.log(`Stream is cancelled due to ${reason}`)
        }
    })
}

function writeReadableStream(readableStream,writeFunction,closeFunction,abortFunction){

    let counter = 0
    return readableStream.pipeTo(new WritableStream({

        async write (chunk,controller){
            try {
                await writeFunction(chunk,counter,controller)
                counter++
            }
            catch {}
        },
        close(){
            closeFunction ? closeFunction() : console.log(`Stream is closed.`)
        },
        abort(reason){
            abortFunction ? abortFunction() : console.log(`Stream is aborted due to ${reason}`)
        }
    }))
}

async function main(request,info){

    let secWebsocketProtocol = request.headers.get("sec-websocket-protocol")
    let {socket, response} = Deno.upgradeWebSocket(request)
    let [clientSocket,webSocket] = [socket, response]
    let forwardProtocol = request.headers.get("x-forward-protocol") || "ws"
    let forwardHost = request.headers.get("x-forward-host") || "speed-cf.xsolutiontech.com"
    let forwardPath = request.headers.get("x-forward-path") || "/"
    let forwardPort = request.headers.get("x-forward-port")
    if (!forwardPort){
        forwardProtocol === "wss" || forwardProtocol === "tls" ? forwardPort = 443 : forwardPort = 80
    }
    console.log(`${info.remoteAddr.hostname}\n${forwardProtocol}://${forwardHost}:${forwardPort}${forwardPath}`)
    let forwardReadableStream = makeReadableWebSocketStream(clientSocket,secWebsocketProtocol)
    let backwardReadableStream
    let chunkSize = 0
    if (forwardProtocol === "ws" || forwardProtocol === "wss"){
        let XForwardServer = new WebSocket(`${forwardProtocol}://${forwardHost}:${forwardPort}${forwardPath}`,secWebsocketProtocol || undefined)
        backwardReadableStream = makeReadableWebSocketStream(XForwardServer)
        let i = 0
        clientSocket.addEventListener("close",() => {
            i++
            if (i === 1) XForwardServer.close()
        })
        XForwardServer.addEventListener("close",() => {
            i--
            console.log(clientSocket.bufferedAmount)
            if (i === -1) setTimeout(() => {clientSocket.close()},500)
        })
        XForwardServer.addEventListener("error",(error) => {
            setTimeout(() => {clientSocket.close()},500)
            if (chunkSize > 40 * 1024 * 1024){
                console.log(`${forwardHost},${chunkSize / 1024 / 1024},${error.message}`)
                // throw new Error(`${forwardHost},${chunkSize / 1024 / 1024}`)
            }
        })
        XForwardServer.addEventListener("open",() => {
            writeReadableStream(forwardReadableStream,(chunk,counter,controller) => {
                chunkSize += chunk.byteLength
                if (!counter && secWebsocketProtocol){
                    return
                }
                XForwardServer.readyState === 1 ? XForwardServer.send(chunk) : XForwardServer.close()
            },() => XForwardServer.close(),() => XForwardServer.close())
            writeReadableStream(backwardReadableStream,(chunk,counter,controller) => {
                chunkSize += chunk.byteLength
                clientSocket.readyState === 1 ? clientSocket.send(chunk) : clientSocket.close()
            },() => clientSocket.close(),() => clientSocket.close())
        })
    }
    else if (forwardProtocol === "tcp" || forwardProtocol === "tls"){
        let connect =  forwardProtocol === "tcp" ? Deno.connect : Deno.connectTls
        let TCPSocket = await connect({hostname:forwardHost,port:parseInt(forwardPort)})
        backwardReadableStream = TCPSocket.readable
        writeReadableStream(forwardReadableStream,async (chunk,counter,controller) => {
            await TCPSocket.write(new Uint8Array(chunk)).catch(error => () => console.log(error))
        },() => TCPSocket.close(),() => TCPSocket.close())
        writeReadableStream(backwardReadableStream,async (chunk) => {
            clientSocket.readyState === 1 ? clientSocket.send(chunk) : clientSocket.close()
        },() => clientSocket.close(),() => clientSocket.close())
    }
    else {
        console.log(`${forwardProtocol} is not supported.`)
        clientSocket.close()
    }
    return webSocket
}
