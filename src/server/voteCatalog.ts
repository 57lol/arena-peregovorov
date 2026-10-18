// Варианты закреплены за буквами: старые голоса не переименовывать.
export const VOTE_CAST = [
  {
    "id": "sosed",
    "name": "Тимур",
    "role": "Сосед по общаге, 19 лет",
    "variants": [
      {
        "id": "A",
        "voiceId": "oW7TMKNYKHRJq1pltXn4",
        "source": "game:opening-dorm.mp3"
      },
      {
        "id": "B",
        "voiceId": "oW7TMKNYKHRJq1pltXn4",
        "source": "sosed:a_bright_2"
      }
    ]
  },
  {
    "id": "gopnik",
    "name": "Серый",
    "role": "Парень у остановки",
    "variants": [
      {
        "id": "A",
        "voiceId": "o7PE01v4XYHJP2sq6EFk",
        "source": "game:opening-stop.mp3"
      },
      {
        "id": "B",
        "voiceId": "FP2qcDQWQ7CgS27ZRsjU",
        "source": "gopnik:a_south_3"
      }
    ]
  },
  {
    "id": "rinat",
    "name": "Марат",
    "role": "Поставщик упаковки",
    "variants": [
      {
        "id": "A",
        "voiceId": "L3CkPyBD4H0mUL4BrRQ4",
        "source": "rinat:c_cool_1"
      },
      {
        "id": "B",
        "voiceId": "vyxcHHDdYg49mcMOjw3H",
        "source": "rinat:a_dry_1"
      },
      {
        "id": "C",
        "voiceId": "vQxSi2EuaRWwBw3nn6dK",
        "source": "game:opening-tara.mp3"
      }
    ]
  },
  {
    "id": "admin",
    "name": "Лариса Петровна",
    "role": "Администратор магазина",
    "variants": [
      {
        "id": "A",
        "voiceId": "bAioNtCxod9djFkHsm4y",
        "source": "admin2:a_nasal_1"
      },
      {
        "id": "B",
        "voiceId": "ej3B6TjT1dffDLF4niHF",
        "source": "admin:a_tired_3"
      },
      {
        "id": "C",
        "voiceId": "bFJT36AxkMD1XGAhSlls",
        "source": "admin:b_firm_2"
      },
      {
        "id": "D",
        "voiceId": "NUa5MQrfzgHxj4sfEk7V",
        "source": "game:opening-shop.mp3"
      }
    ]
  },
  {
    "id": "olga",
    "name": "Дарина",
    "role": "Инженер, кандидат на работу",
    "variants": [
      {
        "id": "A",
        "voiceId": "pS0Vm2TDyApKkwL0YIqj",
        "source": "game:opening-offer.mp3"
      },
      {
        "id": "B",
        "voiceId": "SfzhnMN5M1Bl1JBzo6up",
        "source": "olga:a_soft_3"
      }
    ]
  },
  {
    "id": "buyer",
    "name": "Роза",
    "role": "Директор по закупкам",
    "variants": [
      {
        "id": "A",
        "voiceId": "I7awGfosdGeHXOCnsK9G",
        "source": "game:opening-client.mp3"
      },
      {
        "id": "B",
        "voiceId": "mmoPkcd0Cyjv2qJSKYk6",
        "source": "buyer:a_chesty_2"
      }
    ]
  },
  {
    "id": "palych",
    "name": "Палыч",
    "role": "Бригадир",
    "variants": [
      {
        "id": "A",
        "voiceId": "zQzMRXieet72bdZKfX9V",
        "source": "game:opening-launch.mp3"
      },
      {
        "id": "B",
        "voiceId": "smRdbMtYtjXzkkWkMbIT",
        "source": "palych:c_tatar_1"
      }
    ]
  }
] as const
