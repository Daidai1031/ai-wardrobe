export interface WeatherData {
  city: string;
  temp: number;
  feels_like: number;
  humidity: number;
  description: string;
  icon: string;
  wind_speed: number;
}

export async function getWeather(city: string): Promise<WeatherData | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`
    );
    const data = await res.json();
    if (!res.ok) return null;

    return {
      city: data.name,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather?.[0]?.description || "",
      icon: data.weather?.[0]?.icon || "",
      wind_speed: data.wind?.speed || 0,
    };
  } catch (err) {
    console.error("Weather fetch error:", err);
    return null;
  }
}
