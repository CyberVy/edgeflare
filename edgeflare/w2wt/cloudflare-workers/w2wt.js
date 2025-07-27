import { connect } from 'cloudflare:sockets'

export default {
    async fetch(request){

        try {
            let upgradeHeader = request.headers.get('upgrade')
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                return Response.redirect("https://not-found.xsolutiontech.com")
            }
            else {
                return await main(request)
            }
        }
        catch (error){
            console.log(error)
            return new Response(null)
        }
    }
}

function makeReadableWebSocketStream(websocket,secWebsocketProtocol) {

    function base64StrToUint8Array(base64Str) {

        base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/')
        return  Uint8Array.from(atob(base64Str), (c) => c.charCodeAt(0)).buffer
    }

    let secWebsocketProtocolArray
    return new ReadableStream({
        start(controller) {

            websocket.addEventListener('message', async message => {
                if (message.data.stream){
                    controller.enqueue((await message.data.stream().getReader().read()).value)
                }
                else{
                    controller.enqueue(message.data)
                }
            })
            websocket.addEventListener('close', () => {
                controller.close()
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
            await writeFunction(chunk,counter,controller)
            counter++
        },
        close(){
            closeFunction ? closeFunction() : console.log(`Stream is closed.`)
        },
        abort(reason){
            abortFunction ? abortFunction() : console.log(`Stream is aborted due to ${reason}`)
        }
    }))
}


async function main(request){


    let forwardProtocol = request.headers.get("x-forward-protocol") || "ws"
    let forwardHost = request.headers.get("x-forward-host") || "speed-cf.xsolutiontech.com"
    let forwardPath = request.headers.get("x-forward-path") || "/"
    let forwardPort = request.headers.get("x-forward-port")
    if (!forwardPort){
        forwardProtocol === "wss" || forwardProtocol === "tls" ? forwardPort = 443 : forwardPort = 80
    }
    console.log(`${request.headers.get("cf-connecting-ip")}\n${forwardProtocol}://${forwardHost}:${forwardPort}${forwardPath}`)

    if (forwardProtocol === "ws" || forwardProtocol === "wss"){
        forwardProtocol === "ws" ? forwardProtocol = "http" : 0
        forwardProtocol === "wss" ? forwardProtocol = "https" : 0
        if (/^\d+\.\d+\.\d+\.\d+$/.test(forwardHost)){
            forwardHost = `${forwardHost.replace(/\./g,"-")}.nip.io`
        }
        let _request = new Request(`${forwardProtocol}://${forwardHost}:${forwardPort}${forwardPath}`,request)
        return await fetch(_request)
    }
    else if (forwardProtocol === "tcp" || forwardProtocol === "tls"){
        let secWebsocketProtocol = request.headers.get("sec-websocket-protocol") || ""
        let [webSocket,clientSocket] = Object.values(new WebSocketPair())
        clientSocket.accept()

        let forwardReadableStream = makeReadableWebSocketStream(clientSocket,secWebsocketProtocol)
        let backwardReadableStream

        let TCPSocket = connect({hostname:forwardHost,port:parseInt(forwardPort)},{secureTransport:forwardProtocol === "tls" ? "on" : "off",allowHalfOpen:false})
        let TCPSocketWriter = TCPSocket.writable.getWriter()
        backwardReadableStream = TCPSocket.readable
        writeReadableStream(forwardReadableStream,async (chunk,counter,controller) => {
            await TCPSocketWriter.write(new Uint8Array(chunk)).catch(error => () => console.log(error))
        },() => TCPSocket.close(),() => TCPSocket.close())
        writeReadableStream(backwardReadableStream,async (chunk) => {
            clientSocket.readyState === 1 ? clientSocket.send(chunk) : clientSocket.close()
        },() => clientSocket.close(),() => clientSocket.close())
        return new Response(null,{status:101,webSocket:webSocket})
    }
    else {
        throw new Error(`${forwardProtocol} is not supported.`)
    }
}
