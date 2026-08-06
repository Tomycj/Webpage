"use strict"

const ssConnectButton = document.getElementById("ss-connect");

ssConnectButton.onclick = _=> {

    const ip = document.getElementById("ss-ip").value;

    const url = ip === "" ? "https://tomycj.ddnsfree.com/client" : ip;

    fetch(url, {
        method: "GET",
    }).then((res)=>{

        res.json().then((body)=>{console.log(body)})

    })

}

