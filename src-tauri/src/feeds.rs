//! What JARVIS reads from the web for his widgets: stock quotes (Yahoo Finance, no key, about
//! 15 minutes late for the B3) and the weather (Open-Meteo, no key). The page's CSP keeps the
//! UI off other sites, so the requests go from here.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Yahoo answers "Too Many Requests" to clients that do not look like a browser.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TIMEOUT: Duration = Duration::from_secs(10);
/// A widget's list, or one question.
pub const MAX_SYMBOLS: usize = 20;
const MAX_SYMBOL: usize = 16;
const FORECAST_DAYS: usize = 5;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    /// As the user knows it ("PETR4", "HGLG11", "AAPL").
    pub symbol: String,
    pub name: String,
    pub price: f64,
    /// Since the previous close, as a fraction (-0.0818).
    pub change: f64,
    pub currency: String,
    /// When the price is from (seconds since the epoch).
    pub time: i64,
    /// Today's prices, oldest first (the widget's sparkline).
    pub points: Vec<f64>,
    /// Set (and the rest empty) when this one could not be read.
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    /// "Curitiba, Paraná".
    pub place: String,
    pub current: Current,
    /// Today first.
    pub days: Vec<Day>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    /// °C.
    pub temperature: f64,
    pub apparent: f64,
    /// %.
    pub humidity: f64,
    /// WMO weather code.
    pub code: i64,
    /// km/h.
    pub wind: f64,
    pub day: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    /// "AAAA-MM-DD".
    pub date: String,
    pub code: i64,
    pub max: f64,
    pub min: f64,
    /// Chance of rain, %.
    pub rain: f64,
}

/// One agent for every request: its pool keeps the connections (and their TLS sessions) to Yahoo
/// and Open-Meteo alive between refreshes, instead of a new handshake per quote every minute.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).build().into())
}

fn get(url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let mut request = agent().get(url).header("User-Agent", USER_AGENT);
    for (key, value) in query {
        request = request.query(*key, *value);
    }
    let mut response = request.call().map_err(|error| format!("Sem resposta de {}: {error}", host(url)))?;
    let text = response.body_mut().read_to_string().map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| format!("Resposta inesperada de {}: {error}", host(url)))
}

fn host(url: &str) -> &str {
    url.split('/').nth(2).unwrap_or(url)
}

/// "petr4" → "PETR4.SA" (B3: four letters and a number, as stocks, units and FIIs go); other
/// tickers ("AAPL", "^BVSP", "BTC-USD") as they are. None for anything else.
pub fn yahoo_symbol(symbol: &str) -> Option<String> {
    let symbol = symbol.trim().to_uppercase();
    let symbol = symbol.strip_suffix(".SA").unwrap_or(&symbol);
    if symbol.is_empty() || symbol.len() > MAX_SYMBOL || !symbol.chars().all(|c| c.is_ascii_alphanumeric() || "^.=-".contains(c)) {
        return None;
    }
    let bytes = symbol.as_bytes();
    let b3 = bytes.len() >= 5
        && bytes.len() <= 7
        && bytes[..4].iter().all(u8::is_ascii_alphabetic)
        && bytes[4].is_ascii_digit()
        && bytes[4..].iter().take_while(|b| b.is_ascii_digit()).count() <= 2
        && bytes[4..].iter().skip_while(|b| b.is_ascii_digit()).all(u8::is_ascii_alphabetic);
    Some(if b3 { format!("{symbol}.SA") } else { symbol.to_string() })
}

/// The quote in a chart answer (`/v8/finance/chart/<symbol>`).
fn parse_chart(symbol: &str, body: &Value) -> Result<Quote, String> {
    let result = &body["chart"]["result"][0];
    if result.is_null() {
        let reason = body["chart"]["error"]["description"].as_str().unwrap_or("não encontrado");
        return Err(format!("{symbol}: {reason}"));
    }
    let meta = &result["meta"];
    let price = meta["regularMarketPrice"].as_f64().ok_or_else(|| format!("{symbol}: sem preço"))?;
    let previous = meta["chartPreviousClose"].as_f64().or_else(|| meta["previousClose"].as_f64());
    let change = match (meta["regularMarketChangePercent"].as_f64(), previous) {
        (Some(percent), _) => percent / 100.0,
        (None, Some(previous)) if previous > 0.0 => price / previous - 1.0,
        _ => 0.0,
    };
    let name = [&meta["longName"], &meta["shortName"]]
        .iter()
        .filter_map(|value| value.as_str())
        .map(|name| name.split_whitespace().collect::<Vec<_>>().join(" "))
        .find(|name| !name.is_empty())
        .unwrap_or_else(|| symbol.to_string());
    let points = result["indicators"]["quote"][0]["close"].as_array().map(|closes| closes.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    Ok(Quote {
        symbol: symbol.to_string(),
        name,
        price,
        change,
        currency: meta["currency"].as_str().unwrap_or("BRL").to_string(),
        time: meta["regularMarketTime"].as_i64().unwrap_or(0),
        points,
        error: None,
    })
}

fn failed(symbol: &str, error: String) -> Quote {
    Quote { symbol: symbol.to_string(), name: String::new(), price: 0.0, change: 0.0, currency: String::new(), time: 0, points: Vec::new(), error: Some(error) }
}

/// Today's quote of each symbol, in order (at most `MAX_SYMBOLS`, fetched side by side).
pub fn quotes(symbols: &[String]) -> Vec<Quote> {
    std::thread::scope(|scope| {
        let jobs: Vec<_> = symbols
            .iter()
            .take(MAX_SYMBOLS)
            .map(|asked| {
                scope.spawn(move || {
                    let Some(yahoo) = yahoo_symbol(asked) else {
                        return failed(asked.trim(), format!("Código inválido: {}", asked.trim()));
                    };
                    let shown = yahoo.strip_suffix(".SA").unwrap_or(&yahoo).to_string();
                    let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{yahoo}");
                    get(&url, &[("range", "1d"), ("interval", "15m")])
                        .and_then(|body| parse_chart(&shown, &body))
                        .unwrap_or_else(|error| failed(&shown, error))
                })
            })
            .collect();
        jobs.into_iter().map(|job| job.join().unwrap_or_else(|_| failed("?", "Falha ao ler a cotação".into()))).collect()
    })
}

/// "Curitiba, Paraná": the first place Open-Meteo's geocoding finds, and where it is.
fn parse_place(city: &str, body: &Value) -> Result<(String, f64, f64), String> {
    let place = &body["results"][0];
    let (Some(latitude), Some(longitude)) = (place["latitude"].as_f64(), place["longitude"].as_f64()) else {
        return Err(format!("Não encontrei a cidade “{city}”"));
    };
    let name = place["name"].as_str().unwrap_or(city);
    let region = place["admin1"].as_str().filter(|region| *region != name);
    let label = region.map_or_else(|| name.to_string(), |region| format!("{name}, {region}"));
    Ok((label, latitude, longitude))
}

fn parse_forecast(place: String, body: &Value) -> Result<Weather, String> {
    let now = &body["current"];
    let number = |value: &Value| value.as_f64().ok_or("Previsão incompleta");
    let current = Current {
        temperature: number(&now["temperature_2m"])?,
        apparent: number(&now["apparent_temperature"])?,
        humidity: number(&now["relative_humidity_2m"])?,
        code: now["weather_code"].as_i64().ok_or("Previsão incompleta")?,
        wind: number(&now["wind_speed_10m"])?,
        day: now["is_day"].as_i64() != Some(0),
    };
    let daily = &body["daily"];
    let column = |name: &str| daily[name].as_array().cloned().unwrap_or_default();
    let (dates, codes, maxes, mins, rains) = (column("time"), column("weather_code"), column("temperature_2m_max"), column("temperature_2m_min"), column("precipitation_probability_max"));
    let days = (0..dates.len().min(FORECAST_DAYS))
        .filter_map(|i| {
            Some(Day {
                date: dates[i].as_str()?.to_string(),
                code: codes.get(i)?.as_i64()?,
                max: maxes.get(i)?.as_f64()?,
                min: mins.get(i)?.as_f64()?,
                rain: rains.get(i).and_then(Value::as_f64).unwrap_or(0.0),
            })
        })
        .collect();
    Ok(Weather { place, current, days })
}

/// The weather now and the next days in `city`.
pub fn weather(city: &str) -> Result<Weather, String> {
    let city = city.trim();
    if city.is_empty() {
        return Err("Diga a cidade".into());
    }
    let found = get("https://geocoding-api.open-meteo.com/v1/search", &[("name", city), ("count", "1"), ("language", "pt"), ("format", "json")])?;
    let (place, latitude, longitude) = parse_place(city, &found)?;
    let days = FORECAST_DAYS.to_string();
    let forecast = get(
        "https://api.open-meteo.com/v1/forecast",
        &[
            ("latitude", &latitude.to_string()),
            ("longitude", &longitude.to_string()),
            ("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day"),
            ("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            ("timezone", "auto"),
            ("forecast_days", &days),
        ],
    )?;
    parse_forecast(place, &forecast)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn b3_tickers_get_the_exchange_suffix() {
        assert_eq!(yahoo_symbol("petr4").as_deref(), Some("PETR4.SA"));
        assert_eq!(yahoo_symbol(" HGLG11 ").as_deref(), Some("HGLG11.SA"));
        assert_eq!(yahoo_symbol("PETR4.SA").as_deref(), Some("PETR4.SA"));
        assert_eq!(yahoo_symbol("TAEE11").as_deref(), Some("TAEE11.SA"));
        assert_eq!(yahoo_symbol("AAPL").as_deref(), Some("AAPL"));
        assert_eq!(yahoo_symbol("^BVSP").as_deref(), Some("^BVSP"));
        assert_eq!(yahoo_symbol("BTC-USD").as_deref(), Some("BTC-USD"));
        let long = "A".repeat(20);
        for bad in ["", "PETR4/../x", "petr 4", long.as_str()] {
            assert_eq!(yahoo_symbol(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_chart_gives_the_price_the_change_and_the_day() {
        // Trimmed from a real answer (PETR4.SA, 2026-10-27).
        let body = json!({ "chart": { "result": [{
            "meta": { "currency": "BRL", "symbol": "PETR4.SA", "regularMarketTime": 1793045134, "regularMarketPrice": 53.88,
                      "longName": "Petróleo Brasileiro S.A. - Petrobras", "shortName": "PETROBRAS   PN      N2", "chartPreviousClose": 58.68 },
            "indicators": { "quote": [{ "close": [58.1, null, 55.2, 53.88] }] }
        }], "error": null } });
        let quote = parse_chart("PETR4", &body).unwrap();
        assert_eq!((quote.symbol.as_str(), quote.price, quote.currency.as_str(), quote.time), ("PETR4", 53.88, "BRL", 1793045134));
        assert_eq!(quote.name, "Petróleo Brasileiro S.A. - Petrobras");
        assert!((quote.change - (53.88 / 58.68 - 1.0)).abs() < 1e-9);
        assert_eq!(quote.points, vec![58.1, 55.2, 53.88]);

        // The percent Yahoo gives wins; a short name is tidied.
        let short = json!({ "chart": { "result": [{ "meta": { "regularMarketPrice": 160.5, "regularMarketChangePercent": 1.5, "shortName": "FII  CSHG LOG" } }] } });
        let quote = parse_chart("HGLG11", &short).unwrap();
        assert_eq!((quote.name.as_str(), quote.change, quote.currency.as_str()), ("FII CSHG LOG", 0.015, "BRL"));

        let missing = json!({ "chart": { "result": null, "error": { "code": "Not Found", "description": "No data found, symbol may be delisted" } } });
        assert_eq!(parse_chart("XXXX3", &missing).unwrap_err(), "XXXX3: No data found, symbol may be delisted");
    }

    #[test]
    fn the_forecast_reads_now_and_the_next_days() {
        let place = json!({ "results": [{ "name": "Curitiba", "latitude": -25.42778, "longitude": -49.27306, "admin1": "Paraná" }] });
        assert_eq!(parse_place("curitiba", &place).unwrap(), ("Curitiba, Paraná".to_string(), -25.42778, -49.27306));
        let capital = json!({ "results": [{ "name": "São Paulo", "latitude": -23.5, "longitude": -46.6, "admin1": "São Paulo" }] });
        assert_eq!(parse_place("sp", &capital).unwrap().0, "São Paulo");
        assert_eq!(parse_place("Atlantis", &json!({ "generationtime_ms": 0.1 })).unwrap_err(), "Não encontrei a cidade “Atlantis”");

        // Trimmed from a real answer (Curitiba, 2026-10-27).
        let body = json!({
            "current": { "temperature_2m": 14.7, "apparent_temperature": 12.7, "relative_humidity_2m": 68, "weather_code": 3, "wind_speed_10m": 11.1, "is_day": 1 },
            "daily": { "time": ["2026-10-27", "2026-10-28"], "weather_code": [51, 61], "temperature_2m_max": [18.8, 21.7], "temperature_2m_min": [10.4, 11.8], "precipitation_probability_max": [8, null] }
        });
        let weather = parse_forecast("Curitiba, Paraná".into(), &body).unwrap();
        assert_eq!(weather.current, Current { temperature: 14.7, apparent: 12.7, humidity: 68.0, code: 3, wind: 11.1, day: true });
        assert_eq!(weather.days[0], Day { date: "2026-10-27".into(), code: 51, max: 18.8, min: 10.4, rain: 8.0 });
        assert_eq!(weather.days[1].rain, 0.0);
        assert!(parse_forecast("x".into(), &json!({ "current": {} })).is_err());
    }

    /// Real requests: `cargo test --lib -- --ignored feeds --nocapture`.
    #[test]
    #[ignore]
    fn feeds_answer_for_real() {
        let found = quotes(&["PETR4".into(), "hglg11".into(), "NOPE99".into()]);
        println!("{found:#?}");
        assert!(found[0].error.is_none() && found[0].price > 0.0);
        assert!(found[1].error.is_none());
        assert!(found[2].error.is_some());
        println!("{:#?}", weather("Curitiba").unwrap());
    }
}
