function normalize_m3u8_playlist(m3u8_string, m3u8_origin, proxy = "") {

    // avoid recursive proxy
    if (proxy && m3u8_string.includes(proxy)) proxy = ""

    const base_url = `${m3u8_origin.protocol}//${m3u8_origin.host}`
    const base_path = `${base_url}${m3u8_origin.pathname.split("/").slice(0, -1).join("/")}`

    const lines = m3u8_string.split("\n")
    const result = []

    for (let line of lines) {
        if (!line) {
            result.push(line)
            continue
        }

        if (line.startsWith("#")) {
            if (line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-MAP")) {
                line = line.replace(/URI="(.*?)"/, (_, uri) => {
                    if (/^https?:\/\//.test(uri)) return `URI="${proxy}${uri}"`
                    return uri.startsWith("/") ? `URI="${proxy}${base_url}${uri}"` : `URI="${proxy}${base_path}/${uri}"`
                })
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

    if (!m3u8_string.includes("#EXT-X-PLAYLIST-TYPE")) {
        result.splice(1, 0, "#EXT-X-PLAYLIST-TYPE:VOD")
    }

    return result.join("\n")
}

async function fetch_m3u8_playlist(url,proxy = ""){
    const r = []
    const text = await fetch(url).then(r => r.text())
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

async function http_forward(request) {
    const url = new URL(request.url)
    try {
        const target_url = new URL(decodeURIComponent(url.pathname.slice(1)))

        // add search params for the input url,
        // if the url is decoded by decodeURIComponent, this snippet will do nothing,
        // because the input url can not receive the search params,
        // which is included in the decoded url.
        if (target_url.search === "" && url.search !== ""){
            target_url.search = url.search
        }
        url.search = ""

        console.log(target_url)
        let _request = new Request(target_url,request)
        let referer = _request.headers.get("referer")
        if (!referer){
            _request.headers.set("referer",target_url.toString())
        }
        _request.headers.set("origin","Edge")

        let _response = await fetch(_request)
        _request.headers.delete("authorization")

        while (true){
            if (_response.status.toString().startsWith("3")){
                const redirect_url = _response.headers.get("location")
                if (!redirect_url){
                    break
                }
                _request = new Request(redirect_url,_request)
                _request.headers.set("referer",redirect_url.toString())
                _response = await fetch(_request)
            }
            else{
                break
            }
        }
        const response = new Response(_response.body,{status:_response.status})

        _response.headers.forEach((v,k) => response.headers.set(k,v))
        response.headers.set("Access-Control-Allow-Origin","*")
        url.pathname = "/" // proxy url
        return response
    }
    catch (error){
        return new Response(error)
    }
}

async function main(request,env,ctx){

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
        const m3u8_playlist =  await fetch_m3u8_playlist(target_url,url.href)
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


export default {
    async fetch(request,env,ctx) {
        try{
            return await main(request,env,ctx)
        }
        catch (error){
            return new Response(error.message)
        }
    }
}

