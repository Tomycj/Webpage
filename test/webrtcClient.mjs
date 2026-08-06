"use strict"

const ssConnectButton = document.getElementById("ss-connect");

ssConnectButton.onclick = _=> {

    const ip = document.getElementById("ss-ip").value;

    console.log(ip)

    fetch(`https://tomycj.ddnsfree.com/client`, {
        method: "GET",
    }).then((res)=>{

        res.json().then((body)=>{console.log(body)})

    })

}
