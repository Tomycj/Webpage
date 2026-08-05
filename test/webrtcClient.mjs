"use strict"

const ssConnectButton = document.getElementById("ss-connect");

ssConnectButton.onclick = _=> {

    const ip = document.getElementById("ss-ip").value;

    console.log(ip)

    fetch(`http://[${ip}]`, {
        method: "GET",
    }).then((res)=>{

        res.json().then((body)=>{console.log(body)})

    })

}
