function is_live_m3u8(m3u8_string){
    return !m3u8_string.includes("#EXT-X-ENDLIST")
}

/**
 * normalize the m3u8 playlist, according to
 * [RFC8216](https://datatracker.ietf.org/doc/html/rfc8216)
 */
function normalize_m3u8_playlist(m3u8_string, m3u8_origin, proxy = "") {

    if (proxy) {
        if (!/^https?:\/\//.test(proxy)){
            throw new Error("Please input a valid proxy url.")
        }
        // avoid recursive proxy
        if (m3u8_string.includes(proxy)) {
            proxy = ""
        }
    }

    const base_url = `${m3u8_origin.protocol}//${m3u8_origin.host}`
    const base_path = `${base_url}${m3u8_origin.pathname.split("/").slice(0, -1).join("/")}`

    const lines = m3u8_string.split("\n")
    const result = []

    let max_chunk_duration = 0

    for (let line of lines) {
        if (!line) {
            result.push(line)
            continue
        }

        if (line.startsWith("#EXT-X-TARGETDURATION")) continue

        if (line.startsWith("#")) {
            if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-MAP")) {
                line = line.replace(/URI="(.*?)"/, (_, uri) => {
                    if (/^https?:\/\//.test(uri)) return `URI="${proxy}${uri}"`
                    return uri.startsWith("/") ? `URI="${proxy}${base_url}${uri}"` : `URI="${proxy}${base_path}/${uri}"`
                })
            }
            // fix possible EXT-X-TARGETDURATION error
            if (line.startsWith("#EXTINF")){
                const chunk_duration =  parseInt(line.split("#EXTINF:")[1],10) + 1
                max_chunk_duration = Math.max(chunk_duration, max_chunk_duration)
            }
            result.push(line)
        }
        else {
            if (/^https?:\/\//.test(line)) {
                result.push(`${proxy}${line}`)
            }
            else {
                const full_url = line.startsWith("/") ? `${base_url}${line}` : `${base_path}/${line}`
                result.push(`${proxy}${full_url}`)
            }
        }
    }

    result.splice(1, 0, `#EXT-X-TARGETDURATION:${max_chunk_duration}`)

    // fix possible #EXT-X-PLAYLIST-TYPE error
    if (!is_live_m3u8(m3u8_string) && !m3u8_string.includes("#EXT-X-PLAYLIST-TYPE")) {
        result.splice(1, 0, "#EXT-X-PLAYLIST-TYPE:VOD")
    }

    return result.join("\n")
}

async function fetch_m3u8_playlist(url, proxy = "",headers = null){
    const r = []
    headers = headers ? new Headers(headers) : undefined
    const text = await fetch(url,{headers:headers}).then(r => r.text())
    const _url = new URL(url)
    if (!text.includes("#EXTM3U")){
        console.log("Not a valid m3u8 playlist url.")
        return r
    }
    if (text.includes("#EXT-X-STREAM-INF")){
        for (const item of text.split("\n")){
            if (!item.startsWith("https://") && !item.startsWith("http://")){
                // chunk line with relative path
                if (item && !item.startsWith("#")){
                    if (item[0] === "/"){
                        _url.pathname = item
                    }
                    else {
                        _url.pathname = `${_url.pathname.split("/").slice(0,-1).join("/")}/${item}`
                    }
                    const m3u8_string = await fetch(_url).then(r => r.text())
                    r.push(normalize_m3u8_playlist(m3u8_string,new URL(_url),proxy))
                }
            }
            // chunk line with http path
            else {
                const m3u8_string = await fetch(item).then(r => r.text())
                r.push(normalize_m3u8_playlist(m3u8_string,new URL(item),proxy))
            }
        }
        console.log(`${r.length} resolution detected.`)
    }
    else {
        r.push(normalize_m3u8_playlist(text,new URL(_url),proxy))
    }
    return r
}

async function build_request(request){
    let url = new URL(request.url)
    const target_url = new URL(decodeURIComponent(url.pathname.slice(1)))
    // add search params for the input url,
    // if the url is decoded by decodeURIComponent, this snippet will do nothing,
    // because the input url can not receive the search params,
    // which is included in the decoded url.
    if (target_url.search === "" && url.search !== ""){
        target_url.search = url.search
    }
    const _request = new Request(target_url,{
        method:request.method,
        headers:request.headers,
        body: request.bodyUsed || ["HEAD","GET"].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer())
    })

    _request.headers.set("referer",target_url.toString())
    _request.headers.set("origin","Edge")
    _request.headers.delete("accept")
    if (target_url.hostname.includes("youtube")){
        _request.headers.set("user-agent","Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
    }

    return _request
}

async function http_forward(request) {
    try {
        let _request = await build_request(request)
        let _response = await fetch(_request)
        _request.headers.delete("authorization")
        while (true){
            if (_response.status.toString().startsWith("3")){
                let redirect_url = _response.headers.get("location")
                _request = new Request(redirect_url,_request)
                _request.headers.set("referer",redirect_url.toString())
                _response = await fetch(_request)
            }
            else{
                break
            }
        }
        let response = new Response(_response.body,{status:_response.status})
        _response.headers.forEach((v,k) => response.headers.set(k,v))
        if (request.headers.get("origin")){
            response.headers.set("Access-Control-Allow-Origin",request.headers.get("origin"))
        }
        else {
            response.headers.set("Access-Control-Allow-Origin","*")
        }
        response.headers.set("Access-Control-Allow-Credentials","true")
        if (_response.headers.get("Set-Cookie")){
            const cookie = _response.headers.get("Set-Cookie")

            let new_cookie = cookie.replace(/Domain=[^;]+/gi, "")
            if (!new_cookie.includes("SameSite=None")) new_cookie += "; SameSite=None"
            if (!new_cookie.includes("Secure")) new_cookie += "; Secure"
            new_cookie = new_cookie.replace(/; ;/g,";")
            response.headers.set("Set-Cookie", new_cookie)
        }
        response.headers.delete("X-Frame-Options")
        response.headers.delete("Content-Length")
        return response
    }
    catch (error){
        return new Response(error)
    }
}

async function main(request,info){

    const url = new URL(request.url)
    if (!url.toString().startsWith("https") && request.cf.country === "CN"){
        url.protocol = "https"
        return Response.redirect(url.toString(),302)
    }
    const target_url = new URL(decodeURIComponent(url.pathname.slice(1)))
    const response = await http_forward(request)

    let content_type = response.headers.get("content-type") || ""
    content_type = content_type.toLowerCase()
    if (content_type.includes("mpegurl") || url.pathname.includes(".m3u")){
        url.pathname = "/"
        const m3u8_playlist =  await fetch_m3u8_playlist(target_url,url.href,(await build_request(request)).headers)
        if (m3u8_playlist.length){
            const r =  new Response(m3u8_playlist.reverse()[0])
            response.headers.forEach((v,k) => {
                r.headers.set(k,v)
            })
            return r
        }
    }
    return response
}

Deno.serve(async (request,info) => {
    try {
        return await main(request,info)
    }
    catch (error){
        return new Response(error.message)
    }
})
