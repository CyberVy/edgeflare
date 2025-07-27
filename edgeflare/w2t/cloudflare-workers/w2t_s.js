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
                ctx.waitUntil(new Logger().logRemote(`[SHADOWSOCKS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${request.url}\n${request.headers.get("user-agent") || ""}\n${request.cf.httpProtocol}`))
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
            host = `[${host}]`
            break
    }
    return {address:host,port:port,isCFIP:isCFIP}
}

async function parseShadowsocksHeader(data) {

    function ASCII2Str(ascii) {

        let characters = ascii.map(code => String.fromCharCode(code))

        return characters.join('')

    }

    data = new Uint8Array(data)
    let addressType = data[0]
    let headerLen, addressRemote, portRemote, dstAddrLen

    switch (addressType) {
        // domain
        case 3:
            dstAddrLen = data[1]
            addressRemote = data.subarray(2, 2 + dstAddrLen).toString()
            portRemote = data[2 + dstAddrLen] << 8 | data[ 2 + dstAddrLen + 1]
            headerLen = 4 + dstAddrLen
            addressRemote = ASCII2Str(addressRemote.split(","))
            break
        // ipv4
        case 1:
            addressRemote = data.subarray(1, 5).join('.').toString()
            portRemote = data[5] << 8 | data[6]
            headerLen = 7
            break
        // ipv6
        case 4:
            let addressUint8Array = data.slice(1, 17)
            portRemote = data[17] << 8 | data[18]
            let dataView = new DataView(addressUint8Array.buffer)
            let ipv6 = []
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16))
            }
            addressRemote = ipv6.join(':')
            headerLen = 19
            break
        default:
            return {isUDP:false, rawDataIndex:0, message: "", hasError: false, addressType: null, headerLen: null, addressRemote: null, portRemote: null}
    }
    return {isUDP:false, rawDataIndex:headerLen, message: "", hasError: false, addressType: addressType, headerLen: headerLen, addressRemote: addressRemote, portRemote: portRemote}
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
                catch {
                    websocket.close()
                }
            })
            websocket.addEventListener('close', () => {
                try{
                    controller.close()
                }
                catch {}
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
                // console.log(error.message)]
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

async function directly_relay_to_other_ws_proxy(request,proxies){
    for (let item in proxies){
        if (item === request.cf.colo && proxies[item])
            return await fetch(proxies[item],request)
    }
}

async function main(request,env,ctx){

    let {HTTPS_CF_address,HTTPS_CF_port,HTTP_CF_address,HTTP_CF_port,SNI_proxy_address,SNI_proxy_port,NAT64_Out,logger} = initializeGlobalVariableViaWebsocketPath(request)

    let response = await directly_relay_to_other_ws_proxy(request,LANDING_SERVERS)
    if (response){
        logger.info = `[SHADOWSOCKS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${request.cf.colo}: ${LANDING_SERVERS[request.cf.colo]}`
        ctx.waitUntil(logger.log("\n>>>"))
        return response
    }

    let webSocketPair = new WebSocketPair()
    let [webSocket, clientSocket] = Object.values(webSocketPair)
    clientSocket.accept()

    let earlyDataHeader = request.headers.get('sec-websocket-protocol') || ''
    let readableWebSocketStream = makeReadableWebSocketStream(clientSocket, earlyDataHeader)
    let TCPSocket
    let TCPSocketWriter
    let TCPRTT = -1
    let connection_time = 0
    let upload_size = 0
    let download_size = 0

    writeReadableStream(readableWebSocketStream,async (chunk,counter) => {
        upload_size += chunk.byteLength
        if (!counter){
            let {
                hasError, message, portRemote, addressRemote, rawDataIndex, isUDP,
            } = await parseShadowsocksHeader(chunk)
            let rawClientData = chunk.slice(rawDataIndex)

            logger.info  = `[SHADOWSOCKS] ${request.cf.colo} ${request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip")}\nAS${request.cf.asn} ${request.cf.asOrganization} ${request.cf.city || request.cf.country} ${request.cf.clientTcpRtt || 0}ms\n${addressRemote}:${portRemote}`
            let {address,port,isCFIP} = await transformAddressAndPortForCloudflareTCPAPI(addressRemote,portRemote,HTTPS_CF_address,HTTPS_CF_port,HTTP_CF_address,HTTP_CF_port,SNI_proxy_address,SNI_proxy_port,NAT64_Out)
            let i = 0
            TCPSocket = connect({hostname:address,port:port},{allowHalfOpen:true})
            connection_time = Date.now()
            TCPSocket.closed.then(() => {
                i++
                if (i === 1){
                    setTimeout(() => {clientSocket.close()},500)
                    connection_time -= Date.now()
                    connection_time *= -1
                    ctx.waitUntil(logger.log(`-> ${address}:${port}\nConnection closed by TCPSocket. (${connection_time/1000}s/${TCPRTT}ms/${(upload_size/1024).toFixed(1)}KB/${(download_size/1024).toFixed(1)}KB)`))
                }
            })
            clientSocket.addEventListener("close",() => {
                i --
                if (i === -1){
                    TCPSocket.close()
                    connection_time -= Date.now()
                    connection_time *= -1
                    ctx.waitUntil(logger.log(`-> ${address}:${port}\nConnection closed by Websocket. (${connection_time/1000}s/${TCPRTT}ms/${(upload_size/1024).toFixed(1)}KB/${(download_size/1024).toFixed(1)}KB)`))
                }
            })
            TCPSocketWriter = TCPSocket.writable.getWriter()
            TCPSocketWriter.write(rawClientData)
            writeReadableStream(TCPSocket.readable,async (chunk,counter) => {
                download_size += chunk.byteLength
                if (!counter){
                    TCPRTT -= Date.now()
                    TCPRTT *= -1
                }
                clientSocket.send(chunk)
            },() => () => clientSocket.close(),() => () => clientSocket.close())
        }
        else {
            if (counter === 1){
                TCPRTT = Date.now()
            }
            TCPSocketWriter.write(chunk).catch(error => {})
        }
    },() => clientSocket.close(),() => clientSocket.close())

    return new Response(null, {status: 101, webSocket: webSocket})
}
