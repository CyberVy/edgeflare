export default {
    async fetch(request, env, ctx) {
        let url = new URL(request.url)
        if (!url.toString().startsWith("https") && request.cf.country === "CN"){
            url.protocol = "https"
            return Response.redirect(url.toString(),302)
        }
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
                    let redirect_url = _response.headers.get("location")
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
}

