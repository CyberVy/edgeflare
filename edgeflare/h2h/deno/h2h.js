function normalize_m3u8_playlist(m3u8_string, m3u8_origin , proxy = ""){
    for (const item of m3u8_string.split("\n")){
        if (item) {
            if (!item.startsWith("https://") && !item.startsWith("http://")){
                // non-URL
                if (!item.startsWith("#")){
                    if (item.startsWith("/")){
                        m3u8_string = m3u8_string.replace(item,`${proxy}${m3u8_origin.protocol}//${m3u8_origin.host}${item}`)
                    }
                    else {
                        m3u8_string = m3u8_string.replace(item,`${proxy}${m3u8_origin.protocol}//${m3u8_origin.host}${m3u8_origin.pathname.split("/").slice(0,-1).join("/")}/${item}`)
                    }
                }
                else {
                    if (item.startsWith("#EXT-X-KEY") || item.startsWith("#EXT-X-MAP")){
                        let line = item
                        const key_url = item.match(/URI="(.*)"/)?.[1] || ""
                        if (!key_url.startsWith("https://") && !key_url.startsWith("http://")){
                            if (key_url.startsWith("/")){
                                line = item.replace(/URI="(.*)"/,(match,p1) => `URI="${proxy}${m3u8_origin.protocol}//${m3u8_origin.host}${p1}"`)
                            }
                            else {
                                line = item.replace(/URI="(.*)"/,(match,p1) => `URI="${proxy}${m3u8_origin.protocol}//${m3u8_origin.host}${m3u8_origin.pathname.split("/").slice(0,-1).join("/")}/${p1}"`)
                            }
                        }
                        else {
                            line = item.replace(/URI="(.*)"/,(match,p1) => `URI="${proxy}${p1}"`)
                        }
                        m3u8_string = m3u8_string.replace(item,line)
                    }
                }
            }
            else {
                // URL
                m3u8_string = m3u8_string.replace(item,`${proxy}${item}`)
            }
        }
    }
    return m3u8_string
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
    let url = new URL(request.url)

    try {
        let target_url = new URL(decodeURIComponent(url.pathname.slice(1)))

        // add search params for the input url,
        // if the url is decoded by decodeURIComponent, this snippet will do nothing,
        // because the input url can not receive the search params,
        // which is included in the decoded url.
        if (target_url.search === "" && url.search !== ""){
            target_url.search = url.search
        }
        url.search = ""
        console.log(target_url,request.method)

        let _request = new Request(target_url,{
            method:request.method,
            headers:request.headers,
            body: request.bodyUsed || ["HEAD","GET"].includes(request.method) ? undefined : new Uint8Array(await request.arrayBuffer())
        })

        let referer = _request.headers.get("referer")
        if (!referer){
            _request.headers.set("referer",target_url.toString())
        }
        _request.headers.set("origin","Edge")
        _request.headers.delete("accept")

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
        response.headers.set("Access-Control-Allow-Origin","*")
        url.pathname = "/" // proxy url
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

Deno.serv(async (request,info) => {
    try {
        return await main(request,info)
    }
    catch (error){
        return new Response(error.message)
    }
})
