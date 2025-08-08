import { connect } from 'cloudflare:sockets'

const password = "HelloWorld."
const redirect_target = "https://raw.githubusercontent.com/nginx/nginx/master/docs/html/index.html"

const NAT64_PREFIX = "2001:67c:2960:6464::"
const DEFAULT_HTTP_CF_ADDRESS = "nat64-to-cf.xsolutiontech.com"
const DEFAULT_HTTP_CF_PORT = 80
const DEFAULT_HTTPS_CF_ADDRESS = "nat64-to-cf.xsolutiontech.com"
const DEFAULT_HTTPS_CF_PORT = 443

const LANDING_SERVERS = {}

const TG_TOKENS = []
const TG_ID = ''
const ENFORCE_LOG = false

export default {

    async fetch(request, env, ctx) {

        try {
            let upgradeHeader = request.headers.get('Upgrade')
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                ctx.waitUntil(new Logger().logRemote(`[VLESS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${request.url}\n${request.headers.get("user-agent") || ""}\n${request.cf.httpProtocol}`))
                return new Response((await fetch(redirect_target)).body,{headers:{"content-type":"text/html"}})
            }
            else {
                return await main(request,env,ctx)
            }
        }
        catch (error){
            console.log(error)
            return new Response(null)
        }
    },
}

class Logger {

    constructor(TGTokens, ID, info,parse_mode) {
        this.tokens = TGTokens || TG_TOKENS
        this.master_id = ID || TG_ID
        this.info = info || ``
        this.parse_mode = parse_mode
        this.remote = false
    }

    log(text){
        if (!this.remote){
            let message = `${this.info} ` + `${text}`
            console.log(message)
        }
        else {
            return this.logRemote(text)
        }
    }

    async logRemote(text) {
        let message = `${this.info} ` + `${text}`
        console.log(message)
        this.token = message.includes("www.gstatic.com:80") ? this.tokens[0] : this.tokens[1]

        if (this.token){
            try {
                let r = await fetch('https://api.telegram.org/bot' + this.token + '/' + "sendMessage",
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: this.master_id,
                            text: message,
                            parse_mode: this.parse_mode
                        })
                    })
                return await r.json()
            }
            catch (error) {
                console.log(`logRemote Function error ${error}`)
            }
        }
        else {
            console.log("TG_TOKENS are required to enable logging.")
        }
    }

    async edit(text,message_id){
        let message = `${this.info} ` + `${text}`
        console.log(message)
        try {
            let r = await fetch('https://api.telegram.org/bot' + this.token + '/' + "editMessageText",
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: this.master_id,
                        message_id:message_id,
                        text: message,
                        parse_mode: this.parse_mode
                    })
                })
            return await r.json()
        }
        catch (error) {
            console.log(`logRemote Function error ${error}`)
        }
    }
}

async function getUUIDv5FromPassword(name) {

    async function sha1(array){

        let myDigest = await crypto.subtle.digest({name: 'SHA-1',}, array)

        return new array.constructor(myDigest)
    }

    let str = new TextEncoder().encode(name)
    let u = new Uint8Array(16 + str.length)
    u.set(str,16)
    u = (await sha1(u)).slice(0,-4)

    u[6] = (u[6] & 0x0f) | (5 << 4)
    u[8] = (u[8] & 0x3f) | 0x80

    let to_hex_str = ""
    let item
    for (let i = 0;i < u.length;i++){
        item =  u[i].toString(16)
        if (item.length === 1) {item = "0" + item}
        to_hex_str += item
    }

    let p1 = to_hex_str.slice(0,8)
    let p2 = to_hex_str.slice(8,12)
    let p3 = to_hex_str.slice(12,16)
    let p4 = to_hex_str.slice(16,20)
    let p5 = to_hex_str.slice(20,32)

    let r = p1 + "-" + p2 + "-" + p3 + "-" + p4 + "-" + p5
    console.log(`${name}:${r}`)

    return r

}

function initializeGlobalVariableViaWebsocketPath(request){

    function getSearchParam(request,name){
        let url = new URL(request.url)
        let params = new URLSearchParams(url.search)
        return params.get(name)
    }

    let HTTP_CF_address = DEFAULT_HTTP_CF_ADDRESS
    let HTTP_CF_port = DEFAULT_HTTP_CF_PORT
    let HTTPS_CF_address = DEFAULT_HTTPS_CF_ADDRESS
    let HTTPS_CF_port = DEFAULT_HTTPS_CF_PORT
    let SNI_proxy_address
    let SNI_proxy_port

    let logger = new Logger()
    logger.remote = (!!getSearchParam(request, "log")) || ENFORCE_LOG

    function splitAddressAndPort(IPAndPort){

        let address
        let port
        let splitList = IPAndPort.split(":")
        if (splitList.length === 1){
            address = splitList[0]
            port = null
            return {address,port}
        }
        // ipv4 or domain
        else if(splitList.length === 2){
            address = splitList[0]
            port = parseInt(splitList[1])
            return {address,port}
        }
        // ipv6
        else {
            address = splitList.slice(0,-1).join(":")
            port = parseInt(splitList.slice(-1)[0])
            if (!port){
                address = splitList.join(":")
                port = null
            }
            return {address,port}
        }
    }

    let input_HTTP_CF_address_and_port = getSearchParam(request,"HTTP_CF")
    if (input_HTTP_CF_address_and_port){
        let {address,port} = splitAddressAndPort(input_HTTP_CF_address_and_port)
        HTTP_CF_address = address
        HTTP_CF_port = port
    }

    let input_HTTPS_CF_address_and_port = getSearchParam(request,"HTTPS_CF")
    if (input_HTTPS_CF_address_and_port){
        let {address,port} = splitAddressAndPort(input_HTTPS_CF_address_and_port)
        HTTPS_CF_address = address
        HTTPS_CF_port = port
    }

    let input_SNI_proxy_address_and_port = getSearchParam(request,"SNI_Proxy")
    if (input_SNI_proxy_address_and_port){
        let {address,port} = splitAddressAndPort(input_SNI_proxy_address_and_port)
        SNI_proxy_address = address
        SNI_proxy_port = port
    }

    return {HTTP_CF_address,HTTP_CF_port,HTTPS_CF_address,HTTPS_CF_port,SNI_proxy_address,SNI_proxy_port,NAT64_Out:getSearchParam(request,"NAT64_Out"),logger}
}

async function transformAddressAndPortForCloudflareTCPAPI(
    host,port,HTTPS_CF_address,HTTPS_CF_port,HTTP_CF_address,HTTP_CF_port,SNI_Proxy_address,SNI_Proxy_port,NAT64_Out){

    async function DOH(domain,type = "A",always_work) {

        if (!always_work){
            let domainsNotDOH = ["gstatic.com","google.com","googlevideo.com","cdninstagram.com"]
            for (let item of domainsNotDOH) {
                if (domain.endsWith(item)){
                    return {domain,result:domain}
                }
            }
        }

        let doh_api = `https://1.1.1.1/dns-query?type=${type}`
        let response = await fetch(`${doh_api}&name=${domain}`, {
            method: "GET",
            headers: {"Accept": "application/dns-json"}
        })
        let rsp = await response.json()
        let ans = rsp?.Answer
        let r = []
        if (ans){
            for (let item of ans){
                if (!/[a-zA-Z]/.test(item.data) || item.data.includes(":")){
                    r.push(item.data)
                }
            }
            r.sort()
            return {domain,result:r[0]}
        }
        else {
            console.log(`DNS (type:${type}) query failed.`)
            return {domain,result:domain}
        }
    }

    function checkCFIP(ip){

        let CFIP = [
            [ 16843009n, -1n ],
            [ 16777217n, -1n ],
            [ 1729491968n, -1024n ],
            [ 1729546240n, -1024n ],
            [ 1730085888n, -1024n ],
            [ 1745879040n, -524288n ],
            [ 1746403328n, -262144n ],
            [ 1822605312n, -16384n ],
            [ 2197833728n, -1024n ],
            [ 2372222976n, -16384n ],
            [ 2728263680n, -131072n ],
            [ 2889875456n, -524288n ],
            [ 2918526976n, -4096n ],
            [ 3161612288n, -4096n ],
            [ 3193827328n, -4096n ],
            [ 3320508416n, -1024n ],
            [ 3324608512n, -32768n ],
            [ 3234588160n, -256n ],
            [ 2689558528n, -512n ]
        ]

        function check(ip, cidr){
            let [a, b, c, d] = ip.split(".").map(BigInt)
            ip = a << 24n | b << 16n | c << 8n | d << 0n
            let [range, mask] = cidr
            return (ip & mask) === range
        }
        return CFIP.some((cidr) => check(ip, cidr))
    }

    function checkCFPort(port){

        if ([443,8443,2053,2083,2087,2096].includes(port)){
            return "HTTPS"
        }
        else{
            return "HTTP"
        }
    }

    function transformCFIPAndPort(address,port){
        let isCFIP = false
        if (checkCFIP(address)){
            isCFIP = true
            if (checkCFPort(port) === "HTTP"){
                address = HTTP_CF_address
                port = HTTP_CF_port
            }
            else {
                address = HTTPS_CF_address
                port = HTTPS_CF_port
            }
        }
        return {address,port,isCFIP}
    }

    function d2h(num){
        return parseInt(num).toString(16).padStart(2,"0")
    }

    let isCFIP = false
    let addressType = "IPV4"
    let transformed_CF_address_and_port

    if (/[a-zA-Z]/.test(host)){
        addressType = "Domain"
    }
    if (host.includes(":")){
        addressType = "IPV6"
    }

    switch (addressType){
        case "IPV4":
            if (NAT64_Out){
                let [a,b,c,d] = host.split(".")
                host = `[${NAT64_PREFIX}${d2h(a)}${d2h(b)}:${d2h(c)}${d2h(d)}]`
                break
            }

            if (host === "1.1.1.1"){
                host = `[${NAT64_PREFIX}0101:0101]`
                break
            }
            transformed_CF_address_and_port = transformCFIPAndPort(host,port)
            host = transformed_CF_address_and_port.address
            port = transformed_CF_address_and_port.port
            isCFIP = transformed_CF_address_and_port.isCFIP
            break
        case "Domain":
            if (SNI_Proxy_address && SNI_Proxy_port && port === 443){
                host = SNI_Proxy_address
                port = SNI_Proxy_port
            }
            else {
                if (NAT64_Out){
                    let DNSRecord = await DOH(host)
                    let [a,b,c,d] = DNSRecord.result.split(".")
                    if (DNSRecord.result !== DNSRecord.domain){
                        host = `[${NAT64_PREFIX}${d2h(a)}${d2h(b)}:${d2h(c)}${d2h(d)}]`
                    }
                    return {address:host,port:port,isCFIP}
                }

                let DNSRecord = await DOH(host)
                let domainsForDNS64 = ["render.com"]
                if (domainsForDNS64.includes("*")){
                    let [a,b,c,d] = DNSRecord.result.split(".")
                    host = `[${NAT64_PREFIX}${d2h(a)}${d2h(b)}:${d2h(c)}${d2h(d)}]`
                    return {address:host,port:port,isCFIP}
                }
                for (let item of domainsForDNS64){
                    if (host.endsWith(item)){
                        let [a,b,c,d] = DNSRecord.result.split(".")
                        host = `[${NAT64_PREFIX}${d2h(a)}${d2h(b)}:${d2h(c)}${d2h(d)}]`
                        return {address:host,port:port,isCFIP}
                    }
                }

                if (!/[a-zA-Z]/.test(DNSRecord.result)){
                    transformed_CF_address_and_port = transformCFIPAndPort(DNSRecord.result,port)
                    isCFIP = transformed_CF_address_and_port.isCFIP
                    if (isCFIP){
                        host = transformed_CF_address_and_port.address
                        port = transformed_CF_address_and_port.port
                    }
                    else {
                        host = DNSRecord.result
                    }
                }
            }
            break
        case "IPV6":
            if (host.startsWith("2606:4700")){
                if (checkCFPort(port) === "HTTPS"){
                    host = DEFAULT_HTTPS_CF_ADDRESS
                    port = DEFAULT_HTTPS_CF_PORT
                }
                else{
                    host = DEFAULT_HTTP_CF_ADDRESS
                    port = DEFAULT_HTTP_CF_PORT
                }
            }
            else {
                host = `[${host}]`
            }
            break
    }
    return {address:host,port:port,isCFIP:isCFIP}
}

class Parser{

    constructor() {
        this.version = null
        this.uuid = null
        this.additional = null
        this.additionalLength = null
        this.command = null
        this.initialized = false
        this.encapsulated = false
    }

    // array(uint8) to string
    a2s(data){
        return new TextDecoder().decode(data)
    }

    // decimal to hex
    d2h(num){
        return parseInt(num).toString(16).padStart(2,"0")
    }

    // array(uint8) to uuid
    a2uuid(data) {

        let bytes = []
        for (let i = 0; i < 256; i++) {
            bytes.push(i.toString(16))
        }
        let uuid = ""
        for (let i = 0; i < 16; i++){
            uuid += bytes[data[i]]
            if (i === 3 || i === 5 || i === 7 || i === 9){
                uuid += "-"
            }
        }
        return uuid.toLowerCase()
    }

    parse(data){
        let metadata,metadataLength,id,muxState = 0,payloadType,payload = new Uint8Array([]),payloadLength,
            command,port,address,addressType,addressLength,RCD = new Uint8Array([])
        if (!this.initialized){
            this.version = data[0]
            this.uuid = data.slice(1,17)
            this.uuid = this.a2uuid(this.uuid)
            this.additionalLength = data[17]
            this.additional = data.slice(18,18 + this.additionalLength)
            payload = data.slice(18 + this.additionalLength)
            this.command = payload[0]
            port = payload[1] * 256 + payload[2]
            addressType = payload[3]
            switch (addressType){
                case 1:
                    addressLength = 4
                    address = payload.slice(4,4 + addressLength)
                    RCD = address.slice(4 + addressLength)
                    address = address.join(".")
                    break
                case 2:
                    addressLength = payload[4]
                    address = payload.slice(5,5 + addressLength)
                    RCD = address.slice(5 + addressLength)
                    address = this.a2s(address)
                    break
                case 3:
                    addressLength = 16
                    address = payload.slice(4,4 + addressLength)
                    RCD = address.slice(4 + addressLength)
                    let ipv6 = []
                    for (let i = 0;i < 8;i++){
                        ipv6.push(`${this.d2h(address[2*i])}${this.d2h(address[2*i+1])}`)
                    }
                    address = ipv6.join(":")
                    break
            }
            this.initialized = true
            return {
                version:this.version,uuid:this.uuid,additional:this.additional,additionalLength:this.additionalLength,command:this.command,
                payload,addressType,addressLength,address,port,RCD
            }
        }
        else {
            // mux
            // musState = 1 -> id address port RCD
            // muxState = 2 -> id payload
            // musState = 3 -> id payload
            if (this.command === 3){
                metadataLength = data[0] * 256 + data[1]
                metadata = data.slice(2,2 + metadataLength)
                id = data[2] * 256 + data[3]
                muxState = data[4]
                payloadType = data[5]
                // 1 -> create a new sub connection
                // 2 -> keep a new sub connection
                // 3 -> close a new sub connection
                // 4 -> keep the parent connection
                switch (muxState){
                    case 1:
                        payload = data.slice(6)
                        command = payload[0]
                        payloadLength = payload.length
                        port = payload[1] * 256 + payload[2]
                        addressType = payload[3]
                        switch (addressType){
                            case 1:
                                addressLength = 4
                                address = payload.slice(4,4 + addressLength)
                                RCD = address.slice(4 + addressLength)
                                address = address.join(".")
                                break
                            case 2:
                                addressLength = payload[4]
                                address = payload.slice(5,5 + addressLength)
                                RCD = address.slice(5 + addressLength)
                                address = this.a2s(address)
                                break
                            case 3:
                                addressLength = 16
                                address = payload.slice(4,4 + addressLength)
                                RCD = address.slice(4 + addressLength)
                                let ipv6 = []
                                for (let i = 0;i < 8;i++){
                                    ipv6.push(`${this.d2h(address[2*i])}${this.d2h(address[2*i+1])}`)
                                }
                                address = ipv6.join(":")
                                break
                        }
                        break
                    default:
                        payloadLength = data[6] * 256 + data[7]
                        payload = data.slice(8)
                        break
                }
                return {metadata,metadataLength,id,muxState,payloadType,payload,payloadLength,command,port,address,addressType,addressLength,RCD}
            }
            // no mux
            else {
                return {muxState,payload:data}
            }
        }
    }

    encapsulate(metadataLength,id,muxState,payloadType,payload){
        if (!payload){
            payload = new Uint8Array([])
        }
        let data
        if (this.command === 3){
            data = []
            let payloadLength = payload.length
            data.push(Math.floor(metadataLength/256))
            data.push(metadataLength%256)
            data.push(Math.floor(id/256))
            data.push(id%256)
            data.push(muxState)
            data.push(payloadType)
            switch (payloadType){
                case 1:
                    data.push(Math.floor(payloadLength/256))
                    data.push(payloadLength%256)
                    data = data.concat(Array.from(payload))
                    break
                default:
                    break
            }
            data = new Uint8Array(data)
        }
        else {
            data = payload
        }

        if (!this.encapsulated){
            this.encapsulated = true
            let firstEncapsulatedData = new Uint8Array(2 + data.length)
            firstEncapsulatedData.set(new Uint8Array([this.version,0]),0)
            firstEncapsulatedData.set(new Uint8Array(data),2)
            return firstEncapsulatedData
        }
        else {
            return data
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
            websocket.addEventListener('message', event => {
                try{
                    controller.enqueue(event.data)
                }
                catch (error){
                    websocket.close()
                }
            })
            websocket.addEventListener('close', () => {
                try{
                    controller.close()
                }
                catch{

                }
            })
            websocket.addEventListener('error', (error) => {

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
            websocket.close()
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
            catch (error){
                // console.log(error.message)
            }
        },
        close(){
            closeFunction ? closeFunction() : console.log(`Stream is closed.`)
        },
        abort(reason){
            abortFunction ? abortFunction() : console.log(`Stream is aborted due to ${reason}`)
        }
    }))
}

function streamAutoClose(stream,promise) {
    return new ReadableStream({
        async start(controller) {
            let reader = stream.getReader()
            while (1) {
                let r = await Promise.race([promise, reader.read()])
                if (!r.value && r.value!==0) {
                    controller.close()
                    break
                }
                controller.enqueue(r.value)
            }
        }
    })
}

async function directly_relay_to_other_ws_proxy(request,proxies){
    
    if (request.cf.country === "CN" && ["HKG","NRT","SIN"].includes(request.cf.colo)){
        request.protocol = "http"
        return await fetch(request)
    }
    
    for (let item in proxies){
        if (item === request.cf.colo && proxies[item])
            return await fetch(proxies[item],request)
    }
}

async function main(request,env,ctx){
    let {HTTPS_CF_address,HTTPS_CF_port,HTTP_CF_address,HTTP_CF_port,SNI_proxy_address,SNI_proxy_port,NAT64_Out,logger} = initializeGlobalVariableViaWebsocketPath(request)

    let response = await directly_relay_to_other_ws_proxy(request,LANDING_SERVERS)
     if (response){
        if (LANDING_SERVERS[request.cf.colo]){
            logger.info = `[VLESS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${request.cf.colo}: ${LANDING_SERVERS[request.cf.colo]}`
            ctx.waitUntil(logger.log("\n>>>"))
        }
        return response
    }

    let webSocketPair = new WebSocketPair()
    let [webSocket, clientSocket] = Object.values(webSocketPair)
    clientSocket.accept()
    let earlyDataHeader = request.headers.get('sec-websocket-protocol') || ''
    let readableWebSocketStream = makeReadableWebSocketStream(clientSocket, earlyDataHeader)
    let TCPSockets = {}
    let TCPRTT = -1
    let connection_time = 0
    let upload_size = 0
    let download_size = 0
    let TCPSocketWriters = {}
    let parser = new Parser()
    let uuid_list = ["1a63a7e9-d276-55c7-b51f-6d6b134d8e5d" || await getUUIDv5FromPassword(password)]

    writeReadableStream(readableWebSocketStream,async(chunk,counter) => {
        upload_size += chunk.byteLength
        if (!counter){
            // get uuid and command
            let {uuid,command,address,port,RCD} = parser.parse(new Uint8Array(chunk))
            if (!uuid_list.includes(uuid)){
                clientSocket.close()
                return
            }
            // if mux is not open, get address port and RCD also, then create a new TCP socket
            if (command !== 3){
                logger.info = `[VLESS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${address}:${port}`
                let connectAPITransformer = await transformAddressAndPortForCloudflareTCPAPI(
                    address,port,HTTPS_CF_address,HTTPS_CF_port,HTTP_CF_address,HTTP_CF_port,SNI_proxy_address,SNI_proxy_port,NAT64_Out)
                address = connectAPITransformer.address
                port = connectAPITransformer.port
                TCPSockets[0] = connect({hostname:address,port:port},{allowHalfOpen:true})
                connection_time = Date.now()
                TCPSocketWriters[0] = TCPSockets[0].writable.getWriter()
                TCPSocketWriters[0].write(RCD)
                let i = 0
                TCPSockets[0].closed.then(() => {
                    i++
                    if (i === 1){
                        setTimeout(() => {clientSocket.close()},500)
                        connection_time -= Date.now()
                        connection_time *= -1
                        ctx.waitUntil(logger.log(`-> ${address}:${port}\nConnection closed by TCPSocket. (${connection_time/1000}s/${TCPRTT}ms/${(upload_size/1024).toFixed(1)}KB/${(download_size/1024).toFixed(1)}KB)`))
                    }
                })
                clientSocket.addEventListener("close",() => {
                    i--
                    if (i === -1){
                        TCPSockets[0].close()
                        connection_time -= Date.now()
                        connection_time *= -1
                        ctx.waitUntil(logger.log(`-> ${address}:${port}\nConnection closed by Websocket. (${connection_time/1000}s/${TCPRTT}ms/${(upload_size/1024).toFixed(1)}KB/${(download_size/1024).toFixed(1)}KB)`))
                    }
                })
                writeReadableStream(TCPSockets[0].readable,async(chunk,counter) => {
                    download_size += chunk.byteLength
                    if (!counter){
                        TCPRTT -= Date.now()
                        TCPRTT *= -1
                    }
                    chunk = parser.encapsulate(0,0,0,0,chunk)
                    clientSocket.send(chunk)
                },() => clientSocket.close(),() => clientSocket.close())
            }
        }
        else {
            // no mux, write RCD to the existed TCP socket
            if (parser.command !== 3){
                if (counter === 1){
                    TCPRTT = Date.now()
                }
                TCPSocketWriters[0].write(chunk).catch(error => {})
            }
            // mux
            else {
                let {metadataLength,id,muxState,command,address,port,payloadType,payload,RCD} = parser.parse(new Uint8Array(chunk))
                // mux state is 1,create a TCP socket
                if (muxState === 1) {
                    logger.log(`${address}:${port} ${id}`)
                    let connectAPITransformer = await transformAddressAndPortForCloudflareTCPAPI(
                        address, port, HTTPS_CF_address, HTTPS_CF_port, HTTP_CF_address, HTTP_CF_port, SNI_proxy_address, SNI_proxy_port,NAT64_Out)
                    address = connectAPITransformer.address
                    port = connectAPITransformer.port
                    TCPSockets[id] = connect({hostname: address, port: port}, {allowHalfOpen: true})
                    TCPSocketWriters[id] = TCPSockets[id].writable.getWriter()
                    TCPSocketWriters[id].write(RCD)
                    writeReadableStream(streamAutoClose(TCPSockets[id].readable,TCPSockets[id].closed),async (chunk, counter) => {
                        chunk = parser.encapsulate(4, id, 2, 1, new Uint8Array(chunk))
                        clientSocket.send(chunk)
                    }, () => {}, () => {})
                }
                // mux state is 2,keep and transport data
                else if (muxState === 2) {
                    TCPSocketWriters[id].write(payload)
                }
                // mux state is 3,close the specific TCP socket
                else if (muxState === 3) {
                    TCPSocketWriters[id].write(payload)
                    chunk = parser.encapsulate(4, id, 3, 0)
                    clientSocket.send(chunk)
                    TCPSockets[id].close()
                }
            }
        }
    },() => clientSocket.close(),() => clientSocket.close())
    return new Response(null, {status: 101, webSocket: webSocket})
}
