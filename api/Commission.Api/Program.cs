using System.Text.Json;
using System.Text.Json.Serialization;
using Commission.Api.Data;
using Commission.Api.Engine;
using Commission.Api.Scheduler;

var builder = WebApplication.CreateBuilder(args);

// Pin to port 5000 (overridable via ASPNETCORE_URLS env var) so the web
// app's default NEXT_PUBLIC_API_BASE matches without further config.
if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://localhost:5000");
}

// ---------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------
builder.Services
    .AddControllers()
    .AddJsonOptions(o =>
    {
        // snake_case to match the JS API shape (so the existing client can stay close)
        o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
        o.JsonSerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
        o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(opt => opt.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddSingleton<IDb, Db>();
builder.Services.AddSingleton<FormulaEvaluator>();
builder.Services.AddSingleton<EligibilityEngine>();
builder.Services.AddSingleton<MappingFilters>();
builder.Services.AddSingleton<CalculationPipeline>();

// Daily background cron — auto-runs all active monthly plans + promotes drafts at month-end
builder.Services.AddSingleton<DailyCronService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<DailyCronService>());

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

app.UseExceptionHandler(errApp =>
{
    errApp.Run(async ctx =>
    {
        var feature = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
        ctx.Response.StatusCode = 500;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsJsonAsync(new { error = feature?.Error.Message ?? "Internal server error" });
    });
});

app.MapGet("/api/health", () => new { status = "ok", timestamp = DateTime.UtcNow });
app.MapControllers();

app.Run();
